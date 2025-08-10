#!/usr/bin/env python3
"""
Data Cleaning Example
This script demonstrates basic data cleaning techniques using pandas.
"""

import pandas as pd
import numpy as np

def main():
    print("=== Data Cleaning Example ===\n")
    
    # Create sample data with common issues
    data = {
        'name': ['Alice', 'Bob', 'Charlie', 'David', 'Eve', None],
        'age': [25, 30, None, 35, 28, 40],
        'salary': [50000, 60000, 55000, None, 65000, 70000],
        'department': ['IT', 'HR', 'IT', 'Finance', None, 'IT']
    }
    
    df = pd.DataFrame(data)
    print("Original Data:")
    print(df)
    print("\n" + "="*50 + "\n")
    
    # 1. Handle missing values
    print("1. Handling Missing Values:")
    print(f"Missing values before cleaning:\n{df.isnull().sum()}")
    
    # Fill missing values
    df['name'].fillna('Unknown', inplace=True)
    df['age'].fillna(df['age'].median(), inplace=True)
    df['salary'].fillna(df['salary'].mean(), inplace=True)
    df['department'].fillna('Unknown', inplace=True)
    
    print(f"\nMissing values after cleaning:\n{df.isnull().sum()}")
    print("\nCleaned data:")
    print(df)
    print("\n" + "="*50 + "\n")
    
    # 2. Data validation
    print("2. Data Validation:")
    print(f"Age range: {df['age'].min()} - {df['age'].max()}")
    print(f"Salary range: ${df['salary'].min():,.0f} - ${df['salary'].max():,.0f}")
    print(f"Unique departments: {df['department'].unique()}")
    
    # 3. Data transformation
    print("\n3. Data Transformation:")
    # Create age groups
    df['age_group'] = pd.cut(df['age'], bins=[0, 25, 35, 50, 100], 
                            labels=['Young', 'Adult', 'Senior', 'Elder'])
    print("Added age groups:")
    print(df[['name', 'age', 'age_group']])
    
    print("\n=== Data Cleaning Complete! ===")

if __name__ == "__main__":
    main()
