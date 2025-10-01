docker build -t cloudfront-inspector .

docker run --rm \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -v "$PWD:/output" \
  cloudfront-inspector \
  --dist-id <CLOUDFRONT_DIST_ID> \
  --output /output/distribution.json \
  --table
