# Package Downloader Status Report

## Summary

The package downloader functionality exists but is not exposed through the expected module interface. The test file references modules that don't exist yet.

## Current State

### ? Existing Implementation

**Location**: `modules/project/local/dependencies/downloader/index.ts`

**Class**: `DependenciesDownloader`

**Features**:
- Downloads tarballs from URLs with authentication headers
- Streams downloads for memory efficiency
- Extracts tarballs using `tar-stream` and `zlib`
- Stores files using the unified `File` storage abstraction (local or CDN)
- Implements security measures:
  - Path sanitization to prevent directory traversal
  - Rejects symlinks and hard links
  - 30-second timeout on requests
  - Validates tar entry paths
- Uses a queue system for concurrent downloads (default: 6 concurrent)
- Tracks installed packages in database (`db.installed.set`)

**Usage**: Currently used by `DependenciesInstaller` in `modules/project/local/dependencies/installer.ts`

### ? Missing Modules (Referenced in Tests)

**Test File**: `tests/test-package-install/index.js`

**Missing Module 1**: `@beyond-js/packages/package/installer`
- Expected export: `TarballDownloader`
- Test usage:
  ```javascript
  const { TarballDownloader } = await bimport('@beyond-js/packages/package/installer');
  const downloader = new TarballDownloader(providers, identifier, tarball);
  await downloader.download();
  ```

**Missing Module 2**: `@beyond-js/packages/package/identifier`
- Expected export: `PackageIdentifier`
- Test usage:
  ```javascript
  const { PackageIdentifier } = await bimport('@beyond-js/packages/package/identifier');
  const identifier = new PackageIdentifier({ repository: 'npm', name: 'react', version: '19.1.0' });
  ```

### ?? Old Implementation (Marked for Refactoring/Deletion)

**Location**: `modules/_older-to-be-refactored-or-delete/package-installer/downloader.ts`

**Status**: This is an older implementation that:
- Uses direct filesystem operations (`fs.createWriteStream`)
- Stores files in `.beyond/packages` directory
- Has its own extraction logic
- Uses `PendingPromise` for async coordination
- Should be refactored or removed

## Architecture Overview

### Storage System
- **Abstraction**: `@beyond-js/packages/persistence/storage` (File class)
- **Local**: `modules/persistence/local/storage/file.ts` - Uses `env-paths` for cache directory
- **CDN**: `modules/persistence/cdn/storage/file.ts` - Uses Google Cloud Storage

### Provider System
- **Main**: `modules/providers/main/index.ts` - `PackageProviders` class
- **Types**: `modules/providers/types/provider.ts` - Defines provider interfaces
- Provides `tarball()` method that returns `{ id, path, url, headers }`

### Current Download Flow
1. `DependenciesInstaller` creates `DependenciesDownloader`
2. Downloads are queued (6 concurrent max)
3. For each dependency:
   - Get tarball info from `project.packages.tarball()`
   - Call `DependenciesDownloader.#download()` with `{ id, path, url, headers }`
   - Stream download ? gunzip ? tar extract ? store files
   - Update database with installed package info

## Recommendations

### Option 1: Create Missing Modules (Align with Test Expectations)
1. Create `modules/package/main/installer/index.ts` with `TarballDownloader` class
   - Wrap or adapt `DependenciesDownloader` functionality
   - Expose standalone download interface
   
2. Create `modules/package/main/identifier/index.ts` with `PackageIdentifier` class
   - Should match the interface expected by the test
   - Interface: `{ repository: string, name: string, version: string }`

### Option 2: Update Test to Use Existing Implementation
- Modify test to use `DependenciesDownloader` directly
- Use existing provider/identifier types

### Option 3: Refactor and Consolidate
- Move `DependenciesDownloader` to `modules/package/main/installer/`
- Create `PackageIdentifier` class
- Ensure both test and internal usage work with same implementation

## Code Quality Observations

### ? Good Practices in Current Implementation
- Security-first approach (sanitization, link rejection)
- Stream-based processing (memory efficient)
- Error handling and timeouts
- Concurrent download management
- Unified storage abstraction

### ?? Issues Found

1. **No Deduplication Check**: The downloader does NOT check if a package is already installed before downloading. It will re-download and overwrite existing packages even if they're already in the database and storage.

   **Location**: `modules/project/local/dependencies/downloader/index.ts:29` - `#download()` method
   
   **Recommendation**: Add a check at the start of `#download()`:
   ```typescript
   const existing = await db.installed.get({ id });
   if (existing) {
     // Could also check if files actually exist in storage
     return; // Already installed, skip
   }
   ```

2. **Hardcoded Timeout**: 30-second timeout is hardcoded (line 33)
   - Could be configurable or based on package size

3. **No Retry Logic**: Failed downloads are not retried
   - Network issues could cause permanent failures

4. **Hardcoded Queue Limit**: Queue limit of 6 is hardcoded (line 102)
   - Comment says "4?8 suele ir bien" (4-8 usually works well)
   - Could be configurable

5. **Error Handling**: If extraction fails partway through, files may be partially written
   - No cleanup of partial downloads on error

## Files Related to Package Downloading

- `modules/project/local/dependencies/downloader/index.ts` - Main downloader implementation
- `modules/project/local/dependencies/downloader/queue.ts` - Concurrent download queue
- `modules/project/local/dependencies/downloader/sanitize.ts` - Path sanitization
- `modules/project/local/dependencies/installer.ts` - Uses downloader
- `modules/providers/main/index.ts` - Provides tarball URLs/headers
- `modules/persistence/storage/index.ts` - File storage abstraction
- `tests/test-package-install/index.js` - Test expecting missing modules
