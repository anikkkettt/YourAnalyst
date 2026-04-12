"""Populate a remote Turso (libSQL) instance with sample datasets."""
import pandas as pd
import os
import libsql_client


def populate_turso():
    """Push sample CSV data into the configured Turso database."""
    host = os.environ["TURSO_HOST"]
    token = os.environ["TURSO_AUTH_TOKEN"]

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    clean_host = host.replace("libsql://", "").replace("https://", "")
    url = "libsql://{}".format(clean_host)
    print("Connecting to remote Turso at {}...".format(clean_host))

    try:
        client = libsql_client.create_client_sync(
            url=url,
            auth_token=token
        )

        print("  Dropping stale tables...")
        client.execute("DROP TABLE IF EXISTS employees")
        client.execute("DROP TABLE IF EXISTS sales_data")

        datasets = {
            "fraud_alerts": os.path.join(sample_data_dir, "fraud_alerts.csv"),
        }

        for table_name, file_path in datasets.items():
            if os.path.exists(file_path):
                print("  Uploading {} to Turso...".format(table_name))
                df = pd.read_csv(file_path)
                df.columns = [c.strip().replace(' ', '_').lower() for c in df.columns]

                col_defs = []
                for col in df.columns:
                    dtype = str(df[col].dtype)
                    if "int" in dtype:
                        sql_type = "INTEGER"
                    elif "float" in dtype:
                        sql_type = "REAL"
                    else:
                        sql_type = "TEXT"
                    col_defs.append('"{}" {}'.format(col, sql_type))

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
            else:
                print("  Warning: {} not found.".format(file_path))

        client.close()
        print("Turso population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))
        print("\nTIP: Make sure you have the required driver installed:")
        print("pip install libsql-client")


if __name__ == "__main__":
    populate_turso()
