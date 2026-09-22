# Changelog

All notable changes to this project are documented in this file.

## [1.6.0]

### Fixed

- Added Pi 0.87+ compatibility for `context_edit`. Batch capture now uses Pi's effective provider-context projection, so omitted tool results are not indexed or summarized and replacement content is used instead of the original output.
