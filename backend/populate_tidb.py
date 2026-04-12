"""Populate a remote TiDB Cloud (MySQL-compatible) instance with sample datasets."""
import pandas as pd
import sqlalchemy as sa
import os


def populate_tidb():
    """Push sample CSV data into the configured TiDB Cloud database."""
    user = os.environ["TIDB_USER"]
    password = os.environ["TIDB_PASSWORD"]
    host = os.environ["TIDB_HOST"]
    port = int(os.environ.get("TIDB_PORT", "4000"))
    database = os.environ.get("TIDB_DATABASE", "fortune500")

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    conn_str = "mysql+pymysql://{}:{}@{}:{}/{}".format(
        user, password, host, port, database
    )
    print("Connecting to remote TiDB at {} (with SSL)...".format(host))

    try:
        engine = sa.create_engine(
            conn_str,
            connect_args={"ssl": {"verify_identity": True}}
        )

        with engine.connect() as conn:
            print("  Dropping stale tables...")
            conn.execute(sa.text("DROP TABLE IF EXISTS employees"))
            conn.execute(sa.text("DROP TABLE IF EXISTS sales_data"))
            conn.commit()

        datasets = {
            "loan_portfolio": os.path.join(sample_data_dir, "loan_portfolio.csv"),
        }

        for table_name, file_path in datasets.items():
            if os.path.exists(file_path):
                print("  Uploading {}...".format(table_name))
                df = pd.read_csv(file_path)
                df.columns = [c.strip().replace(' ', '_').lower() for c in df.columns]
                df.to_sql(table_name, engine, if_exists="replace", index=False)
            else:
                print("  Warning: {} not found.".format(file_path))

        print("TiDB population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))


if __name__ == "__main__":
    populate_tidb()
