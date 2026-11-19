# Security

## Reporting a vulnerability

Please report security problems privately to **support@funsoltech.com** with "Security" in
the subject. Do not open a public issue.

Include what you found, how to reproduce it, and what it affects (the `funai-mcp` package,
the plugin files, or the server at `mcp.funai.art`). We will confirm receipt, keep you
informed, and credit you if you wish once a fix is out.

Please do not access other people's accounts or data, run denial-of-service tests, or spend
credits on accounts that are not yours while testing.

## Scope

- `npm/`: the `funai-mcp` stdio bridge, including how it handles sign-in and stored tokens.
- `.claude-plugin/`, `.cursor-plugin/`, `mcp.json`, `.mcp.json`, `skills/` and `server.json`.
- The remote server `https://mcp.funai.art` and FunAI sign-in, even though their code is not
  in this repository.

## Supported versions

Fixes go into the latest release of `funai-mcp`. Update with `npx -y funai-mcp@latest`.
