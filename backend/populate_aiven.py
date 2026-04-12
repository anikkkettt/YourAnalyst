"""Populate a remote MySQL (Aiven) instance with sample datasets."""
import pandas as pd
import sqlalchemy as sa
import os


def populate_remote_mysql():
    """Push sample CSV data into the configured Aiven MySQL database."""
    user = os.environ["MYSQL_USER"]
    password = os.environ["MYSQL_PASSWORD"]
    host = os.environ["MYSQL_HOST"]
    port = int(os.environ.get("MYSQL_PORT", "25235"))
    database = os.environ.get("MYSQL_DATABASE", "defaultdb")

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    conn_str = "mysql+pymysql://{}:{}@{}:{}/{}".format(
        user, password, host, port, database
    )
    print("Connecting to remote MySQL at {} (with SSL)...".format(host))

    try:
        engine = sa.create_engine(
            conn_str,
            connect_args={"ssl": {"verify_identity": True}}
        )

        datasets = {
            "employees": os.path.join(sample_data_dir, "employees.csv"),
            "sales_data": os.path.join(sample_data_dir, "sales_data.csv")
        }

        for table_name, file_path in datasets.items():
            if os.path.exists(file_path):
                print("  Uploading {}...".format(table_name))
                df = pd.read_csv(file_path)
                df.columns = [c.strip().replace(' ', '_').lower() for c in df.columns]
                df.to_sql(table_name, engine, if_exists="replace", index=False)
            else:
                print("  Warning: {} not found.".format(file_path))

        print("Remote MySQL population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))


if __name__ == "__main__":
    populate_remote_mysql()
