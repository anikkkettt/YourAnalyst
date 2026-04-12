"""Populate a remote Supabase (PostgreSQL) instance with sample datasets."""
import pandas as pd
import sqlalchemy as sa
import os


def populate_supabase():
    """Push sample CSV data into the configured Supabase database."""
    user = os.environ["SUPABASE_USER"]
    password = os.environ["SUPABASE_PASSWORD"]
    host = os.environ["SUPABASE_HOST"]
    port = int(os.environ.get("SUPABASE_PORT", "5432"))
    database = os.environ.get("SUPABASE_DATABASE", "postgres")

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")

    conn_str = "postgresql+psycopg2://{}:{}@{}:{}/{}?sslmode=require".format(
        user, password, host, port, database
    )
    print("Connecting to remote Supabase at {} (with SSL)...".format(host))

    try:
        engine = sa.create_engine(conn_str)

        with engine.connect() as conn:
            print("  Dropping stale tables...")
            conn.execute(sa.text("DROP TABLE IF EXISTS employees CASCADE"))
            conn.execute(sa.text("DROP TABLE IF EXISTS sales_data CASCADE"))
            conn.commit()

        datasets = {
            "bank_transactions": os.path.join(sample_data_dir, "bank_transactions.csv"),
            "customer_accounts": os.path.join(sample_data_dir, "customer_accounts.csv")
        }

        for table_name, file_path in datasets.items():
            if os.path.exists(file_path):
                print("  Uploading {}...".format(table_name))
                df = pd.read_csv(file_path)
                df.columns = [c.strip().replace(' ', '_').lower() for c in df.columns]
                df.to_sql(table_name, engine, if_exists="replace", index=False)
            else:
                print("  Warning: {} not found.".format(file_path))

        print("Supabase population complete!")

    except Exception as exc:
        print("Error during population: {}".format(exc))


if __name__ == "__main__":
    populate_supabase()
