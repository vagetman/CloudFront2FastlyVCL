FROM python:3.11-slim

WORKDIR /app

COPY cloudfront_inspector.py .
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

ENV AWS_REGION us-east-1

ENTRYPOINT ["python", "cloudfront_inspector.py"]
