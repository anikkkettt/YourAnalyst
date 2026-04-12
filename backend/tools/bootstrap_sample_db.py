"""
Bootstrap Sample DB — Creates a local SQLite demo database from CSV files.

Reads sample CSV files from the sample_data directory and imports them
into a local SQLite database for quick offline demonstrations.
"""
import pandas as pd
import sqlalchemy as sa
import os


def bootstrap_sample_db():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sample_data_dir = os.path.join(root_dir, "..", "sample_data")
    db_path = os.path.join(root_dir, "demo.db")

    print("Generating demo database at {}...".format(db_path))

    engine = sa.create_engine("sqlite:///{}".format(db_path))

    datasets = {
        "employees": os.path.join(sample_data_dir, "employees.csv"),
        "sales_data": os.path.join(sample_data_dir, "sales_data.csv")
    }

    for table_name, file_path in datasets.items():
        if os.path.exists(file_path):
            print("  Importing {} from {}...".format(table_name, file_path))
            df = pd.read_csv(file_path)
            df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]
            df.to_sql(table_name, engine, if_exists="replace", index=False)
        else:
            print("  Warning: {} not found. Skipping.".format(file_path))

    print("Demo database bootstrap complete.")


if __name__ == "__main__":
    bootstrap_sample_db()
