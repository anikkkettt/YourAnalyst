"""Populate a remote MySQL (Aiven) instance with sample datasets."""
import pandas as pd
import sqlalchemy as sa
import os
import glob

SHEETS = ["Products", "Customers", "SalesTransactions"]


def _find_sample_excel(sample_data_dir):
    matches = glob.glob(os.path.join(sample_data_dir, "*.xlsx"))
    if not matches:
        raise FileNotFoundError("No .xlsx file found in {}".format(sample_data_dir))
    return matches[0]


def populate_remote_mysql():
    """Push all 3 Excel sheets into the configured Aiven MySQL database."""
    user = os.environ["MYSQL_USER"]
    password = os.environ["MYSQL_PASSWORD"]
    host = os.environ["MYSQL_HOST"]
    port = int(os.environ.get("MYSQL_PORT", "25235"))
    database = os.environ.get("MYSQL_DATABASE", "defaultdb")

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    excel_path = _find_sample_excel(sample_data_dir)
    print("Using sample file: {}".format(os.path.basename(excel_path)))

    conn_str = "mysql+pymysql://{}:{}@{}:{}/{}".format(
        user, password, host, port, database
    )
    print("Connecting to remote MySQL at {} (with SSL)...".format(host))

    try:
        engine = sa.create_engine(
            conn_str,
            connect_args={"ssl": {"verify_identity": True}}
        )

        for sheet in SHEETS:
            table_name = sheet.lower()
            print("  Uploading sheet '{}' → table '{}'...".format(sheet, table_name))
            df = pd.read_excel(excel_path, sheet_name=sheet)
            df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]
            df.to_sql(table_name, engine, if_exists="replace", index=False)
            print("    {} rows inserted.".format(len(df)))

        print("Remote MySQL population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))


if __name__ == "__main__":
    populate_remote_mysql()
