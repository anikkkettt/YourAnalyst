"""Populate a remote Turso (libSQL) instance with sample datasets."""
import pandas as pd
import os
import glob
import libsql_client

SHEETS = ["Products", "Customers", "SalesTransactions"]


def _find_sample_excel(sample_data_dir):
    matches = glob.glob(os.path.join(sample_data_dir, "*.xlsx"))
    if not matches:
        raise FileNotFoundError("No .xlsx file found in {}".format(sample_data_dir))
    return matches[0]


def _infer_sql_type(series):
    dtype = str(series.dtype)
    if "int" in dtype:
        return "INTEGER"
    if "float" in dtype:
        return "REAL"
    return "TEXT"


def populate_turso():
    """Push all 3 Excel sheets into the configured Turso database."""
    host = os.environ["TURSO_HOST"]
    token = os.environ["TURSO_AUTH_TOKEN"]

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    excel_path = _find_sample_excel(sample_data_dir)
    print("Using sample file: {}".format(os.path.basename(excel_path)))

    clean_host = host.replace("libsql://", "").replace("https://", "")
    url = "libsql://{}".format(clean_host)
    print("Connecting to remote Turso at {}...".format(clean_host))

    try:
        client = libsql_client.create_client_sync(url=url, auth_token=token)

        for sheet in SHEETS:
            table_name = sheet.lower()
            print("  Uploading sheet '{}' → table '{}'...".format(sheet, table_name))
            df = pd.read_excel(excel_path, sheet_name=sheet)
            df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]

            col_defs = ['"{}" {}'.format(col, _infer_sql_type(df[col])) for col in df.columns]
            create_sql = 'CREATE TABLE IF NOT EXISTS "{}" ({})'.format(
                table_name, ", ".join(col_defs)
            )
            client.execute('DROP TABLE IF EXISTS "{}"'.format(table_name))
            client.execute(create_sql)

            for _, row in df.iterrows():
                placeholders = ", ".join(["?" for _ in row])
                cols = ", ".join(['"{}"'.format(c) for c in df.columns])
                insert_sql = 'INSERT INTO "{}" ({}) VALUES ({})'.format(
                    table_name, cols, placeholders
                )
                values = [None if pd.isna(v) else v for v in row.values]
                client.execute(insert_sql, values)

            print("    {} rows inserted.".format(len(df)))

        client.close()
        print("Turso population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))
        print("\nTIP: Make sure you have the required driver installed:")
        print("pip install libsql-client")


if __name__ == "__main__":
    populate_turso()
