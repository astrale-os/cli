# Admin Graph inventory helper

This internal helper consumes only public `GraphApi.query` pages. It requires a Node selection,
enforces explicit Node and page bounds, rejects repeated cursors and Node identities, and returns a
frozen inventory. It owns no Admin schema meaning and performs no mutation or invocation.
