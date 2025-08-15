# ims

This module is not used directly by the main `Bundler` class, but by its own outputs (`esm`, `local`).

Its purpose is to aggregate the `ims` exposed by the processors that define them, making them accessible to the outputs.

It is exported in the `package.json` to allow this usage without coupling it to the core of the bundler.
