import boto3
import json
import argparse
from tabulate import tabulate
from datetime import datetime


class EnhancedJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def get_distribution_config(client, dist_id):
    return client.get_distribution_config(Id=dist_id)


def get_policy_details(client, policy_type, policy_id):
    if not policy_id:
        return None
    try:
        if policy_type == 'cache':
            return client.get_cache_policy(Id=policy_id)['CachePolicy']
        elif policy_type == 'origin-request':
            return client.get_origin_request_policy(Id=policy_id)['OriginRequestPolicy']
        elif policy_type == 'response-headers':
            return client.get_response_headers_policy(Id=policy_id)['ResponseHeadersPolicy']
    except Exception as e:
        return {"error": str(e)}


def extract_origin_info(origins):
    return [
        {
            "Id": o.get("Id"),
            "DomainName": o.get("DomainName"),
            "OriginPath": o.get("OriginPath"),
            "CustomHeaders": o.get("CustomHeaders"),
            "CustomOriginConfig": o.get("CustomOriginConfig"),
            "S3OriginConfig": o.get("S3OriginConfig"),
            "ConnectionAttempts": o.get("ConnectionAttempts"),
            "ConnectionTimeout": o.get("ConnectionTimeout"),
            "OriginShield": o.get("OriginShield"),
        }
        for o in origins.get("Items", [])
    ]


def extract_behavior_info(client, behaviors, table_rows=None):
    result = []
    for b in behaviors.get("Items", []):
        cache_policy = get_policy_details(client, "cache", b.get("CachePolicyId"))
        origin_req_policy = get_policy_details(client, "origin-request", b.get("OriginRequestPolicyId"))
        resp_headers_policy = get_policy_details(client, "response-headers", b.get("ResponseHeadersPolicyId"))

        behavior = {
            "PathPattern": b.get("PathPattern", "Default (*)"),
            "TargetOriginId": b.get("TargetOriginId"),
            "ViewerProtocolPolicy": b.get("ViewerProtocolPolicy"),
            "AllowedMethods": b.get("AllowedMethods"),
            "CachedMethods": b.get("CachedMethods"),
            "Compress": b.get("Compress"),
            "LambdaFunctionAssociations": b.get("LambdaFunctionAssociations"),
            "FunctionAssociations": b.get("FunctionAssociations"),
            "FieldLevelEncryptionId": b.get("FieldLevelEncryptionId"),
            "CachePolicy": cache_policy,
            "OriginRequestPolicy": origin_req_policy,
            "ResponseHeadersPolicy": resp_headers_policy,
        }

        if table_rows is not None:
            table_rows.append([
                behavior["PathPattern"],
                behavior["TargetOriginId"],
                cache_policy.get("CachePolicyConfig", {}).get("Name") if cache_policy else "None",
                origin_req_policy.get("OriginRequestPolicyConfig", {}).get("Name") if origin_req_policy else "None",
                resp_headers_policy.get("ResponseHeadersPolicyConfig", {}).get("Name") if resp_headers_policy else "None"
            ])

        result.append(behavior)
    return result


def main():
    parser = argparse.ArgumentParser(description="Export CloudFront distribution settings to JSON and/or table")
    parser.add_argument("--dist-id", required=True, help="CloudFront Distribution ID")
    parser.add_argument("--output", default="distribution-dump.json", help="Path to write JSON output")
    parser.add_argument("--table", action="store_true", help="Print a summary table to stdout")
    args = parser.parse_args()

    client = boto3.client("cloudfront")
    config = get_distribution_config(client, args.dist_id)["DistributionConfig"]

    origins = extract_origin_info(config.get("Origins", {}))
    table_rows = [] if args.table else None

    default_behavior = extract_behavior_info(client, {"Items": [config.get("DefaultCacheBehavior")]}, table_rows)
    additional_behaviors = extract_behavior_info(client, config.get("CacheBehaviors", {}), table_rows)

    output = {
        "DistributionId": args.dist_id,
        "Origins": origins,
        "DefaultCacheBehavior": default_behavior,
        "AdditionalCacheBehaviors": additional_behaviors
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2, cls=EnhancedJSONEncoder)

    print(f"\n✅ JSON written to {args.output}")

    if args.table:
        print("\n📊 Behavior Summary Table:\n")
        print(tabulate(
            table_rows,
            headers=["PathPattern", "TargetOrigin", "CachePolicy", "OriginRequestPolicy", "ResponseHeadersPolicy"],
            tablefmt="github"
        ))


if __name__ == "__main__":
    main()
