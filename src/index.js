import { Router } from "@fastly/expressly";

const API_BACKEND = "fastly_api";
const router = new Router();

let baseURL = "https://api.fastly.com/service/";

const JsonContentType = "application/json";

// define a template, which we will populate with code later.
let vcl_snippets = {
  origins: {
    type: "init",
    vcl: "",
  },
  recv: {
    type: "recv",
    vcl: "",
  },
  parse: {
    type: "init",
    vcl: "",
  },
  fetch: {
    type: "fetch",
    vcl: "",
  },
  hash: {
    type: "hash",
    vcl: "",
  },
};

let wildcard = /([?*])/;

// If the URL begins with /cloudfront/service/
router.post("/cloudfront/service/:serviceId([^/]+)", async (req, res) => {
  let serviceId = req.params.serviceId;
  let key = req.headers.get("Fastly-Key");
  if (key == null) {
    let resp = new Response("`Fastly-Key` header must be speficied\n");
    // Construct a new response using the new data but original status.
    res.send(resp);
  }

  let data = await req.json();

  // define placeholders go populate later
  let strictRedirects = [];
  let response = "";
  let pathPattern = {};
  let parse_and_route_sub = "";

  let recv_select_backend = `# header spoofing prevention
    if (fastly.ff.visits_this_service == 0 && req.restarts == 0) {
      unset req.http.hash;
      unset req.http.is_pass;
      unset req.http.new_ttl;
    }\n
    # parse request and set backend, ttl and hashing headers
    set req.backend = parse_and_route();\n`;
  let fetch_sub = `  # fetch sub\n
    if (req.http.is_pass || beresp.http.Expires || beresp.http.Surrogate-Control ~ "max-age" || beresp.http.Cache-Control ~ "(?:s-maxage|max-age)") {
      # keep the ttl here
    } else {
      # set new TTL and cache headers
      if (beresp.status < 399) {
        set beresp.ttl = std.integer2time(std.atoi(req.http.new_ttl));
        set beresp.http.cache-control = "public; max-age=" + std.atoi(req.http.new_ttl);
      }
      if (req.http.new_ttl == "0") {
        return (pass);
      }
    }\n`;

  let originList = "";
  let parse_and_route_hash = "";
  let is_pass = "false";

  data.Origins.forEach((origin_val) => {
    originList += `backend ${backend_name(origin_val.Id)} {\n`;
    let OriginTimeout = "15";
    let FirstByteTimeout = "15";
    let port = "";
    if (origin_val.OriginProtocolPolicy == "http-only") {
      port = "80";
    } else {
      port = "443";
    }
    if (typeof origin_val.CustomOriginConfig !== "undefined" && origin_val.CustomOriginConfig !== null) {
      OriginTimeout = origin_val.CustomOriginConfig.OriginReadTimeout;
      FirstByteTimeout = origin_val.CustomOriginConfig.OriginReadTimeout;
      if (origin_val.OriginProtocolPolicy == "http-only") {
        port = origin_val.CustomOriginConfig.HTTPPort;
      } else {
        port = origin_val.CustomOriginConfig.HTTPSPort;
      }
    } else if (typeof origin_val.S3OriginConfig !== "undefined" && origin_val.S3OriginConfig !== null) {
      FirstByteTimeout = origin_val.S3OriginConfig.OriginReadTimeout;
      port = "443";
    }
    originList += `    .between_bytes_timeout = ${OriginTimeout}s;\n`;
    originList += `    .connect_timeout = ${origin_val.ConnectionTimeout}s;\n    .dynamic = true;\n`;
    originList += `    .first_byte_timeout = ${FirstByteTimeout}s;\n`;
    originList += `    .host = "${origin_val.DomainName}";\n    .max_connections = 200;\n`;
    originList += `    .port = "${port}";\n`;
    originList += `    .share_key = "${serviceId}";\n\n`;
    originList += `    .probe = {        .dummy = true;\n        .initial = 5;\n        .request = "HEAD / HTTP/1.1"  "Host: ${origin_val.DomainName}" "Connection: close";\n        .threshold = 1;\n        .timeout = 2s;\n        .window = 5;\n     }\n}\n`;
  });

  data.DefaultCacheBehavior.forEach((default_val) => {
    parse_and_route_sub += `sub parse_and_route BACKEND {\n
  declare local var.backend BACKEND;
  # set defaults for cases where it isn't set explicitly\n`;

    // update default is_pass
    if (default_val.MaxTTL == 0) {
      parse_and_route_sub += `  set req.http.is_pass = "true";\n`;
    } else {
      parse_and_route_sub += `  set req.http.is_pass = "false";\n`;
      // update default cache behavior TTL
      parse_and_route_sub += `  set req.http.new_ttl = "${default_val.CachePolicy.CachePolicyConfig.DefaultTTL}";\n`;
      if (default_val.CachePolicy !== null) {
        // update default query string behavior hash
        if (default_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "none") {
          parse_and_route_sub += `  set req.http.hash = req.url.path;\n`;
        } else if (default_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "all") {
          parse_and_route_sub += `  set req.http.hash = req.url;\n`;
        }
        // update default header behavior hash
        if (default_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior == "whitelist") {
          for (const [header_idx, header_val] of Object.entries(
            default_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.Headers.Items
          )) {
            parse_and_route_sub += `  set req.http.hash = req.http.hash + req.http.${header_val};\n`;
          }
        }
      }
    }
    // update default backend
    let backend = backend_name(default_val.TargetOriginId);
    parse_and_route_sub += `  set var.backend = ${backend};\n`;
    parse_and_route_sub += `  switch (req.url.path) {\n`;
  });

  data.AdditionalCacheBehaviors.forEach((behavior_val) => {
    // prepare additional cache behaviors

    let pathPattern = behavior_val.PathPattern;
    // turn wildcards into regexes
    if (wildcard.test(behavior_val.PathPattern)) {
      pathPattern = behavior_val.PathPattern.replaceAll(".", `\\.`);
      pathPattern = pathPattern.replaceAll(/([?*])/g, ".$1");
      if (pathPattern.slice(-2) == `.*`) {
        pathPattern = pathPattern.slice(0, -2);
      } else {
        pathPattern = `${pathPattern}$`;
      }
      // insert regex match case
      parse_and_route_sub += `    case ~ "${pathPattern}" : {\n`;
    } else {
      // insert strict match case
      parse_and_route_sub += `    case "${pathPattern}" : {\n`;
    }
    if (typeof behavior_val !== "undefined" && behavior_val.CachePolicy !== null) {
      if (behavior_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "none") {
        parse_and_route_sub += `      set req.http.hash = req.url.path;\n`;
      } else if (behavior_val.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior == "all") {
        parse_and_route_sub += `      set req.http.hash = req.url;\n`;
      }
      if (behavior_val.CachePolicy.CachePolicyConfig.MaxTTL == 0) {
        parse_and_route_sub += `      set req.http.new_ttl = "0";\n`;
        parse_and_route_sub += `      set req.http.is_pass = "true";\n`;
      } else {
        parse_and_route_sub += `      set req.http.new_ttl = "${behavior_val.CachePolicy.CachePolicyConfig.DefaultTTL}";\n`;
      }
      if (behavior_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior == "whitelist") {
        for (const [header_idx, header_val] of Object.entries(
          behavior_val.CachePolicy.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.Headers.Items
        )) {
          parse_and_route_sub += `      set req.http.hash = req.http.hash + req.http.${header_val};\n`;
        }
      }
      // return target backend
      if (typeof behavior_val.TargetOriginId != "undefined" && behavior_val.TargetOriginId != null) {
        let backend = backend_name(behavior_val.TargetOriginId);
        parse_and_route_sub += `      set var.backend = ${backend};\n`;
      }
    }
    parse_and_route_sub += `      break;\n    }\n`;
  });

  // finish parse_and_route sub
  parse_and_route_sub += `  }\n  return var.backend;\n}\n\n`;

  // update snippets' code
  vcl_snippets.origins.vcl = originList;
  vcl_snippets.recv.vcl = recv_select_backend;
  vcl_snippets.parse.vcl = parse_and_route_sub;
  vcl_snippets.fetch.vcl = fetch_sub;
  vcl_snippets.hash.vcl = `  # hash sub\n  if (req.http.hash) {\n    set req.hash += req.http.hash;\n    set req.hash += req.vcl.generation;\n    return (hash);\n  }\n`;

  let active_ver = await getActiveService(serviceId, key);
  let cloned_ver = await cloneActiveVersion(serviceId, key, active_ver);

  await deleteSnippets(serviceId, key, cloned_ver);
  await uploadSnippets(serviceId, key, cloned_ver);
  await activeVersion(serviceId, key, cloned_ver);

  const resp = new Response(response);

  // Construct a new response using the new data but original status.
  res.send(resp);
});

router.all("(.*)", async (req, res) => {
  let json_notfound = {
    msg: "Bad request",
    detail: "Route not found",
  };
  let notFoundResponse = new Response(JSON.stringify(json_notfound, null, 2), {
    status: 404,
    statusText: "Not Found",
    headers: {
      "Content-Type": JsonContentType,
    },
  });
  res.send(notFoundResponse);
});

router.listen();

async function getActiveService(sid, key) {
  let serviceURL = baseURL + sid;
  let newReq = new Request(serviceURL);

  let beresp = await fetch(newReq, {
    backend: API_BACKEND,
    headers: {
      "Fastly-Key": key,
    },
  });

  let resp = await beresp.json();

  // console.log(JSON.stringify(await beresp.json(), null, 2));
  for (const version of Object.values(resp.versions)) {
    if (version.active == true) {
      console.log("Active version:", version.number);
      return version.number;
    }
  }
  // console.log(await beresp.json());
}

async function cloneActiveVersion(sid, key, ver) {
  let serviceURL = `${baseURL}${sid}/version/${ver}/clone`;
  let newReq = new Request(serviceURL);
  let beresp = await fetch(newReq, {
    backend: API_BACKEND,
    method: "PUT",
    headers: {
      "Fastly-Key": key,
    },
  });
  let resp = await beresp.json();

  console.log("Active version cloned to version", resp.number);
  return resp.number;
}

async function deleteSnippets(sid, key, ver) {
  // /service/service_id/version/version_id/snippet/snippet_name
  for (const snippet of Object.keys(vcl_snippets)) {
    let serviceURL = `${baseURL}${sid}/version/${ver}/snippet/${snippet}`;
    let newReq = new Request(serviceURL);
    let beresp = await fetch(newReq, {
      backend: API_BACKEND,
      method: "DELETE",
      headers: {
        "Fastly-Key": key,
      },
    });
    let resp = await beresp.json();
    console.log(`Deleting snippet '${snippet}' - ${beresp.status} ${beresp.statusText}`);
  }
}

async function uploadSnippets(sid, key, ver) {
  let serviceURL = `${baseURL}${sid}/version/${ver}/snippet`;
  for (const [snippet, attrs] of Object.entries(vcl_snippets)) {
    let json_snippet = {
      name: snippet,
      dynamic: 0,
      type: attrs.type,
      content: attrs.vcl,
    };

    let body = JSON.stringify(json_snippet);
    let newReq = new Request(serviceURL);
    let beresp = await fetch(newReq, {
      backend: API_BACKEND,
      method: "POST",
      body,
      headers: {
        "Fastly-Key": key,
        "Content-Type": JsonContentType,
        Accept: JsonContentType,
      },
    });
    // eslint-disable-next-line no-unused-vars
    let resp = await beresp.json();
    console.log(`Uploading  snippet '${snippet}' - ${beresp.status} ${beresp.statusText}`);
    // console.log("Uploading snippet `encoded_redirect_table` - " + JSON.stringify(resp, null, 2));
  }
}

async function activeVersion(sid, key, ver) {
  let serviceURL = `${baseURL}${sid}/version/${ver}/activate`;
  let newReq = new Request(serviceURL);
  let beresp = await fetch(newReq, {
    backend: API_BACKEND,
    method: "PUT",
    headers: {
      "Fastly-Key": key,
    },
  });
  let resp = await beresp.json();

  console.log("Activating version", ver, "- ", JSON.stringify(resp, null, 2));
}

function backend_name(origin_id) {
  return `F_${origin_id}`.replaceAll(".", "_").replaceAll("-", "_").replaceAll("/", "_").replaceAll(" ", "_");
}
