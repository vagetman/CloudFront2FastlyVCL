# CloudFront2VCL

The Fastly C@E app performs conversion of JSON config from CloudFront to Fastly VCL snippets and installs them to a destination service .

# Installation

Fastly CLI is required to test the application locally and install to a Fastly C@E service. To get started, [learn about installing and configuring the CLI](https://developer.fastly.com/learning/tools/cli).
To start with a new C@E app using the current repo use the following commands. You might be prompted for your credentials and a target domain for your new Fastly C@E service.

```shell
$ fastly compute init --from=https://github.com/vagetman/CloudFront2VCL
$ fastly compute publish
```

For more detailed information [please refer to a Fastly article about using JS on C@E](https://developer.fastly.com/learning/compute/javascript/)

It is also possible to test the application locally with the following command

```shell
$ fastly compute serve
```

# Usage

The application expects a JSON uploaded with `POST` method at the following endpoint
`/cloudfront/service/<sid>`, where

- `<sid>` is Fastly Service ID.

It's required to specify a `Fastly-Key` header with [Fastly API token](https://developer.fastly.com/reference/api/#authentication) that has access to the `sid`

For example, the following `curl` command could be used:

```shell
curl https://example.com/cloudfront/service/xRNX3LlEUCVrSqtRtQ6r58 -X POST -data-binary @cloudfront.json -H Fastly-Key:IxWZk_U-HxxuMW8X8v_x8mC5QrnHo4nx
```

`example.com` should be the domain that gets provisioned with your compute service. When testing locally -

```shell
curl http://localhost:7676/cloudfront/service/xRNX3LlEUCVrSqtRtQ6r58 -X POST -data-binary @cloudfront.json -H Fastly-Key:IxWZk_U-HxxuMW8X8v_x8mC5QrnHo4nx
```

## For CSV data format

Cloudfront UI users are working with CSV data format. When the format is used `?format=` query parameter must be used with `csv` value, eg

```shell
curl http://localhost:7676/cloudfront/service/xRNX3LlEUCVrSqtRtQ6r58?format=csv -X POST -data-binary @cloudfront.csv -H Fastly-Key:IxWZk_U-HxxuMW8X8v_x8mC5QrnHo4nx
```

(The `sid` and `Fastly-Key` are not real and provided only for the usage demonstration only. Please use your own SIDs and keys.)
