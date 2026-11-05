# TeleSpy ML batch jobs (billing, anomaly detection, profiling,
# forecasting), run on a schedule by deploy/ml.crontab. Keeps the repo
# layout (/app/ML, /app/BackendDotNet/.env) that training/common.py expects.
FROM python:3.12-slim
WORKDIR /app/ML
COPY requirements.txt .
RUN pip install --no-cache-dir pandas numpy scikit-learn prophet psycopg2-binary
COPY . .
