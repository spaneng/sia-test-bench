# Multi-Agent Implementation Review Checklist

## Critical Issues

### 1. Blocking Operations in Request Handler (HIGH PRIORITY)

**Location:** `src/sia_test_bench/server.py:418-437`

**Issue:** Synchronous CPU-intensive operations block the async event loop:
- `render_test_chart_png()` - matplotlib rendering (blocking)
- `generate_report_pdf()` - WeasyPrint PDF generation (blocking)

**Impact:** 
- Request handler blocks for seconds during PDF generation
- Event loop blocked, affecting other requests and WebSocket connections
- Poor scalability under concurrent requests

**Recommendation:**
- Move PDF generation to background task queue (e.g., asyncio executor)
- Return 202 Accepted with task ID, poll for completion
- Or use async alternatives: `asyncio.to_thread()` or separate worker process

---

### 2. Duplicate Function Definitions (CODE QUALITY)

**Location:** `src/sia_test_bench/application.py:190, 252, 184, 259`

**Issue:** Functions defined twice:
- `check_max_pressure_stabilised()` (lines 190, 252)
- `check_max_pressure_verified()` (lines 184, 259)

**Impact:** Second definitions shadow first ones, potential confusion

**Recommendation:**
- Remove duplicate definitions (keep first implementations)
- Verify no functional differences between duplicates

---

## API Contract Issues

### 3. Inconsistent Metadata Field Mapping

**Location:** `src/sia_test_bench/server.py:403-404`, `test_reports.py:118-119`

**Issue:** 
- Frontend sends `metadata` with fields: `pump_serial`, `pump_model`, `pump_name`, etc.
- Backend stores as `metadata` in test_record
- `test_reports.py:generate_report_pdf()` expects `pump_metadata` key
- Adapter maps `metadata` → `pump_metadata`, but field names differ

**Current flow:**
```
Frontend: { metadata: { pump_serial, pump_model, ... } }
  ↓
Backend stores: { metadata: { pump_serial, pump_model, ... } }
  ↓
test_reports.py adapts: { pump_metadata: { pump_serial, pump_model, ... } }
  ↓
reporting.py expects: { pump_metadata: { name, model, serial, ... } }
```

**Impact:** Template may not receive expected field names

**Recommendation:**
- Standardize on one naming convention
- Add explicit field mapping/documentation
- Validate metadata structure matches template expectations

---

### 4. Missing Error Response Consistency

**Location:** `src/sia_test_bench/server.py:finalize_test_handler`

**Issue:** Error responses use different structures:
- Validation errors: `{ error: "message" }`
- Computation errors: `{ error: "message" }`
- Unexpected errors: `{ error: "Internal server error" }` (no details)

**Recommendation:**
- Standardize error response format: `{ error: { code, message, details? } }`
- Log full exception details server-side, return generic message to client

---

## Data Flow Issues

### 5. Timestamp Conversion Logic Duplication

**Location:** `src/sia_test_bench/frontend/src/store/useTestBenchStore.ts:360-364`

**Issue:** Frontend performs timestamp conversion (ms → seconds) with heuristic:
```typescript
const isMilliseconds = startTimestamp > 946684800000;
```

**Impact:**
- Conversion logic in frontend, backend expects seconds
- No validation backend receives correct format
- Potential for incorrect timestamps if heuristic fails

**Recommendation:**
- Document expected timestamp format (Unix seconds)
- Add backend validation for reasonable timestamp range
- Or accept both formats, normalize backend

---

### 6. No Atomic Save Operation

**Location:** `src/sia_test_bench/server.py:446-449`

**Issue:** Two separate save operations:
```python
self.test_persistence.save_test_record(test_id, test_record)
self.test_persistence.save_report_pdf(test_id, pdf_bytes)
```

**Impact:** If PDF save fails, test record exists but report missing (inconsistent state)

**Recommendation:**
- Combine into atomic transaction or use two-phase commit pattern
- Or check both exist before marking finalized
- Add cleanup if second save fails

---

## Performance & Scalability

### 7. Heavy Compute in Control Path

**Location:** `src/sia_test_bench/application.py:72-76`

**Issue:** `get_tag()` calls in main_loop may block if network I/O is synchronous

**Impact:** If tag reads are blocking, delays control loop iterations

**Recommendation:**
- Verify `get_tag()` is async/non-blocking
- If synchronous, wrap in `asyncio.to_thread()` or make async
- Add timeout handling for tag reads

---

### 8. No Timeout on PDF Generation

**Location:** `src/sia_test_bench/server.py:416-443`

**Issue:** No timeout on chart/PDF generation operations

**Impact:** Request can hang indefinitely if matplotlib/WeasyPrint deadlocks

**Recommendation:**
- Add timeout wrapper (e.g., `asyncio.wait_for()`)
- Return 504 Gateway Timeout if generation exceeds threshold

---

### 9. Wasteful Computation on Retry

**Location:** `src/sia_test_bench/server.py:388-424`

**Issue:** Idempotency check happens after expensive validation/computation

**Impact:** Duplicate requests perform full validation and metrics computation before checking if already finalized

**Recommendation:**
- Move idempotency check to beginning of handler (after test_id validation)
- Return early if already finalized

**Current:**
```python
validate_test_data(payload)  # Expensive
metrics = compute_test_metrics(series)  # Expensive
chart_png_bytes = render_test_chart_png(series)  # Expensive
# Then check idempotency
existing_record = self.test_persistence.load_test_record(test_id)
```

**Should be:**
```python
existing_record = self.test_persistence.load_test_record(test_id)
if existing_record:
    return early
# Then do expensive operations
```

---

## Error Handling

### 10. Partial Failure Handling

**Location:** `src/sia_test_bench/server.py:416-443`

**Issue:** If PDF generation fails after chart generation, chart computation is wasted

**Impact:** 
- CPU cycles wasted
- No intermediate state recovery

**Recommendation:**
- Consider caching chart PNG separately for retry
- Or fail-fast on validation before any generation

---

### 11. Missing Transaction Rollback

**Location:** `src/sia_test_bench/server.py:445-454`

**Issue:** If `save_report_pdf()` fails, test_record is already saved

**Impact:** Inconsistent state - record exists without PDF

**Recommendation:**
- Implement rollback (delete test_record if PDF save fails)
- Or use transaction/log pattern
- Or validate both saves succeed before returning success

---

### 12. Error Handling in Tag Reads

**Location:** `src/sia_test_bench/application.py:71-98`

**Issue:** Broad exception catch masks specific failures

**Recommendation:**
- Catch specific exceptions where possible
- Log exception type for debugging
- Consider partial failure mode (some tags fail, others succeed)

---

## Idempotency

### 13. Race Condition in Finalization

**Location:** `src/sia_test_bench/server.py:388-454`

**Issue:** No locking mechanism prevents concurrent finalization requests

**Impact:** Two simultaneous requests could both pass idempotency check, both generate PDFs

**Recommendation:**
- Use file lock or distributed lock during finalization
- Or use database transaction with unique constraint
- Or check-and-set pattern

---

## Code Style & Consistency

### 14. Inconsistent Error Logging

**Location:** Throughout `server.py`

**Issue:** Mix of `log.error()` and `log.exception()`; some errors logged, others not

**Examples:**
- Line 372: `log.error()` (no exception context)
- Line 507: `log.exception()` (includes traceback)

**Recommendation:**
- Use `log.exception()` in exception handlers (includes traceback)
- Use `log.error()` for non-exception error cases
- Ensure all errors are logged with context

---

### 15. Inconsistent Async Patterns

**Location:** `src/sia_test_bench/server.py`

**Issue:** Handler functions are async but call synchronous blocking operations

**Recommendation:**
- Document which operations are blocking
- Consider marking blocking operations clearly
- Or convert to async where possible

---

### 16. Magic Numbers

**Location:** Multiple files

**Examples:**
- `test_validation.py:9-10`: `MAX_SERIES_LENGTH = 100000`, `MAX_TIMESTAMP_DIFF_SECONDS = 86400 * 30`
- Frontend timestamp heuristic: `946684800000`

**Recommendation:**
- Move constants to configuration
- Document rationale for limits
- Consider making configurable

---

### 17. Type Hints Inconsistency

**Location:** Various files

**Issue:** Some functions have comprehensive type hints, others minimal

**Recommendation:**
- Add type hints consistently
- Use `from __future__ import annotations` for forward references
- Consider mypy for type checking

---

## Frontend Integration

### 18. Error State Not Cleared on New Test

**Location:** `src/sia_test_bench/frontend/src/components/ControlPlane.tsx:330-331`

**Issue:** `clearReportState()` called when starting test, but error handling in `finalizeTestAndGenerateReport` may leave stale error state

**Recommendation:**
- Ensure error state cleared before starting new operation
- Add error state reset in retry logic

---

### 19. Missing Request Cancellation

**Location:** `src/sia_test_bench/frontend/src/store/useTestBenchStore.ts:333-427`

**Issue:** No AbortController for fetch requests

**Impact:** If component unmounts or user navigates away, request continues

**Recommendation:**
- Add AbortController to cancel in-flight requests
- Handle AbortError gracefully

---

## Summary by Priority

### High Priority (Fix Immediately)
1. Blocking operations in request handler (#1)
2. Duplicate function definitions (#2)
3. Move idempotency check earlier (#9)
4. Race condition in finalization (#13)

### Medium Priority (Fix Soon)
5. Inconsistent metadata mapping (#3)
6. No atomic save operation (#6)
7. Missing timeout on PDF generation (#8)
8. Partial failure handling (#10-11)

### Low Priority (Technical Debt)
9. Timestamp conversion logic (#5)
10. Error response consistency (#4)
11. Code style improvements (#14-17)
12. Frontend improvements (#18-19)

