# MCP Integration

Use the actual documented/installed tool schema and validate untrusted results.
Keep stdio protocol output separate from diagnostic output.
Read-only hints describe intent; they do not enforce access control.
Do not register servers, pass credentials or widen host permissions implicitly.
Do not claim interoperability from a generated configuration fragment alone.
Do not spawn MCP servers with an unconstrained inherited environment:
profile, injection, taint and budget variables of the target server must be
pinned or stripped explicitly, because ambient variables silently change
the negotiated tool surface.
