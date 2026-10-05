# Admin Graph inventory helper

This internal helper consumes only public `GraphApi.query` pages. It requires a Node selection,
enforces explicit Node and page bounds, rejects repeated cursors and Node identities, and returns a
frozen inventory. A caller whose Query reaches one Node through several Edges asks for
`deduplicate`: the first value of each Node is kept and its repeats are skipped. It owns no Admin
schema meaning and performs no mutation or invocation.
