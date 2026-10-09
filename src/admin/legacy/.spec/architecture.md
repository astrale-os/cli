# CLI Admin legacy adapters

Each submodule keeps one deprecated Admin journey that a named short-term consumer still needs,
unchanged on the wire. It names its successor, its consumers and its removal condition, and is
deleted in a later breaking CLI release; canonical adapters never import it.

`catalog` keeps the Fleet catalog (Domain entries, publication, install-by-default, and the
catalog install through `Instance.installDomain`) until catalogue and provisioning by version
replace it.
