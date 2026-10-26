"""Read public AWS regional list prices; no credentials or cloud mutations.

Usage: python infra/scripts/price-snapshot.py --region ap-south-1
Use --output to retain the small selected-price snapshot for review.
Prices exclude taxes, account credits, discounts and usage-specific extras.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request


def selected(product):
    attributes = product.get("attributes", {})
    engine = attributes.get("databaseEngine", "")
    usage = attributes.get("usagetype", "").lower()
    family = product.get("productFamily", "")
    if engine == "Aurora PostgreSQL":
        return any(part in usage for part in (
            "serverlessv2", "storageusage", "storageiousage", "iousage", "dataapi"
        ))
    if engine == "PostgreSQL":
        if attributes.get("deploymentOption") != "Single-AZ":
            return False
        if attributes.get("instanceType") in ("db.t4g.micro", "db.t4g.small"):
            # Unused capacity reservations are different products, even when the
            # current numeric price happens to equal regular instance usage.
            return "instanceusage:" in usage
        return family == "Database Storage" and "gp3" in json.dumps(attributes).lower()
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="ap-south-1")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", args.region):
        parser.error("invalid AWS region")
    url = ("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/"
           f"AmazonRDS/current/{args.region}/index.json")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "goa-cost-preflight/1"})
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as error:
        print(f"Public pricing fetch failed: {error}", file=sys.stderr)
        return 1
    rows = []
    for sku, product in data.get("products", {}).items():
        if not selected(product):
            continue
        prices = [
            {"unit": dimension["unit"], "usd": dimension["pricePerUnit"].get("USD"),
             "description": dimension["description"], "effectiveDate": term["effectiveDate"]}
            for term in data.get("terms", {}).get("OnDemand", {}).get(sku, {}).values()
            for dimension in term.get("priceDimensions", {}).values()
        ]
        if prices:
            rows.append({"sku": sku, "family": product.get("productFamily"),
                         "attributes": product["attributes"], "prices": prices})
    snapshot = {"source": url, "retrievedAt": datetime.now(timezone.utc).isoformat(),
                "region": args.region, "publicationDate": data.get("publicationDate"),
                "version": data.get("version"), "currency": "USD", "products": rows}
    if not rows:
        print("No matching products found; do not assume zero cost.", file=sys.stderr)
        return 2
    rendered = json.dumps(snapshot, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
