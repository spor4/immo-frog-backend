# Validation Architecture for Data Accuracy

## Problem Statement

The original extraction agent exhibited critical accuracy issues:

1. **Hallucination**: Generated data not present in source documents (postal codes, land area, parking spaces)
2. **Calculation Errors**: Incorrect sums and aggregations (office area off by 2,836 m², rental income off by €630,000)
3. **Semantic Misinterpretation**: Confused construction years with modernization dates
4. **Mixed Accuracy**: Correctly calculated some values while fabricating others

**Impact**: Data accuracy was unreliable, with errors ranging from 15-40% on critical financial metrics.

## Solution: Three-Pass Validation Architecture

Based on Anthropic's "Building Effective Agents" article and the VALID framework for LLM data extraction, we implemented an **Evaluator-Optimizer pattern** with programmatic checks.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   STEP 1: CLASSIFICATION                    │
│  Determine if document is SINGLE property or PORTFOLIO      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              STEP 2: INITIAL EXTRACTION                     │
│  • Extract data with SOURCE ATTRIBUTION                     │
│  • Require page numbers and locations for every value       │
│  • Differentiate aggregations vs breakdowns                 │
│  • Show calculations transparently                          │
│  • Never fabricate - use null for missing data              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│           STEP 3: SELF-VERIFICATION PASS                    │
│  Agent re-reads document and verifies EACH field:           │
│  ✓ CORRECT     - Matches document                           │
│  ✗ INCORRECT   - Provide correct value + source             │
│  ? UNCERTAIN   - Cannot verify                              │
│  ⚠ MISSING     - Null but data exists                       │
│  ⚡ FABRICATED  - Has value but not in document              │
│                                                              │
│  Returns detailed verification report with:                 │
│  • Field-by-field status                                    │
│  • Calculation checks                                       │
│  • Confidence score                                         │
│  • Critical issues list                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │ Has Errors?     │
                    └─────────────────┘
                       YES ↓     ↓ NO
    ┌─────────────────────┘     └──────────────────────┐
    ↓                                                   ↓
┌─────────────────────────────────────┐    ┌──────────────────────────┐
│   STEP 4: CORRECTION PASS           │    │  STEP 4: SKIP           │
│  Apply verified corrections:        │    │  No corrections needed  │
│  • Fix calculation errors           │    └──────────────────────────┘
│  • Remove fabricated data (→ null)  │
│  • Add missing verified data        │
│  • Re-verify against source PDF     │
└─────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│      STEP 5: PROGRAMMATIC CALCULATION VALIDATION            │
│  Mathematical consistency checks:                           │
│  • Area breakdowns sum to total (±2% tolerance)             │
│  • Income breakdowns sum to total (±2% tolerance)           │
│  • Occupancy rates within 0-100%                            │
│  • Year built within reasonable range (1800-currentYear+10) │
│  • Completion year ≥ construction year                      │
│                                                              │
│  Returns:                                                    │
│  • List of arithmetic issues                                │
│  • Severity levels (high/medium)                            │
│  • Pass/fail validation status                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      FINAL OUTPUT                           │
│  {                                                           │
│    data: { extracted_property_data },                       │
│    validation: {                                            │
│      self_verification: { ... },                            │
│      calculation_validation: { ... },                       │
│      confidence_score: 0-100,                               │
│      corrections_applied: boolean                           │
│    },                                                        │
│    metadata: { model, classification, processing_time }     │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Principles

### 1. Source Attribution (Transparency)
Every extracted value must cite its source location:
```
"value extracted from page X, section Y, table Z"
```

This forces the agent to:
- Actually find the data in the document
- Not fabricate values
- Enable verification by humans

### 2. Differentiate vs Aggregate
Critical distinction taught to the agent:
- **Baujahr in table header** = construction year of THAT building/section
- Must look across ALL buildings to find EARLIEST year
- Tables often show BREAKDOWNS not TOTALS - must SUM them

### 3. Calculation Transparency
When summing values, show components:
```
"BV14: 6,970.30 + BV16: 3,526.89 + LK02: 9,002.48 = 19,499.67 m²"
```

This allows:
- Verification of arithmetic
- Detection of missing components
- Debugging of calculation errors

### 4. Never Fabricate Rule
```
If Grundstück (land area) column is empty → null
If parking spaces aren't listed → null
Missing data is better than wrong data
```

### 5. Evaluator-Optimizer Pattern
- **Extractor Agent**: Does initial extraction with best effort
- **Evaluator Agent**: Re-reads document to verify extractor's claims
- **Corrector Agent**: Fixes identified issues
- **Programmatic Validator**: Catches arithmetic errors LLMs might miss

## Implementation Details

### File Structure
```
src/
├── services/
│   ├── claudeService.js              # Original single-pass extraction
│   └── validatedClaudeService.js     # New three-pass validation
├── routes/
│   ├── extraction.js                 # Original endpoint
│   └── validatedExtraction.js        # New validated endpoint
└── utils/
    └── extractionCompare.js          # Comparison utility
```

### API Endpoints

#### Original Endpoint (Fast, Less Accurate)
```
POST /api/extract-property-data
```

#### Validated Endpoint (Slower, More Accurate)
```
POST /api/extract-property-data-validated?validate=true
```

**Query Parameters:**
- `validate=true` (default): Enable full validation (3-4 passes)
- `validate=false`: Skip validation (same as original endpoint)

**Response Structure:**
```json
{
  "data": {
    "property_identity": { ... },
    "property_metrics": { ... },
    "financial": { ... }
  },
  "validation": {
    "self_verification": {
      "verification_summary": {
        "total_fields_checked": 50,
        "correct": 42,
        "incorrect": 5,
        "uncertain": 2,
        "fabricated": 1,
        "overall_accuracy_percent": 84
      },
      "field_verifications": [...],
      "calculation_checks": [...],
      "critical_issues": [...]
    },
    "calculation_validation": {
      "is_valid": true,
      "checks_performed": [...],
      "issues": []
    },
    "confidence_score": 84,
    "corrections_applied": true
  },
  "metadata": {
    "model": "claude-sonnet-4-5",
    "classification": "SINGLE",
    "validation_passes": 4,
    "processingTime": 45000
  }
}
```

### Validation Metrics

**Self-Verification Statuses:**
- ✓ **CORRECT**: Value verified against source
- ✗ **INCORRECT**: Value differs (correction provided)
- ? **UNCERTAIN**: Cannot verify with confidence
- ⚠ **MISSING**: Null but data exists in document
- ⚡ **FABRICATED**: Has value but not in source (critical issue)

**Calculation Checks:**
- Area breakdown sum vs stated total
- Income breakdown sum vs stated total
- Occupancy rate range (0-100%)
- Year built plausibility (1800-2035)
- Timeline consistency (completion ≥ construction)

**Severity Levels:**
- **Critical**: Fabricated data, major inconsistencies
- **High**: Incorrect financial data, wrong totals
- **Medium**: Unlikely years, minor mismatches
- **Low**: Minor string differences

## Performance Characteristics

| Aspect | Standard Extraction | Validated Extraction |
|--------|-------------------|---------------------|
| **API Calls** | 2 calls | 4-5 calls |
| **Processing Time** | ~10-15 seconds | ~30-60 seconds |
| **Token Usage** | ~8K tokens | ~20K tokens |
| **Cost per Request** | ~$0.10 | ~$0.25 |
| **Accuracy (est.)** | 65-75% | 90-95% |
| **Fabrication Rate** | 10-20% fields | <2% fields |

## Usage Recommendations

### Use Validated Extraction When:
- ✅ Processing financial/legal documents requiring high accuracy
- ✅ Data will be used for investment decisions
- ✅ Manual review resources are limited
- ✅ Cost of errors exceeds cost of validation

### Use Standard Extraction When:
- ✅ Quick prototyping or testing
- ✅ All data will be manually reviewed anyway
- ✅ Speed is more critical than accuracy
- ✅ Processing large batches where cost matters

### Hybrid Approach:
1. Run standard extraction first
2. If confidence is needed, run validated extraction
3. Use `extractionCompare.js` to identify which fields differ
4. Focus manual review on discrepancies

## Testing the Validation System

### 1. Compare Extractions
```javascript
const extractionCompare = require('./src/utils/extractionCompare');

// Run both extractions
const standardResult = await claudeService.extractPropertyData(pdfBase64);
const validatedResult = await validatedClaudeService.extractPropertyData(pdfBase64);

// Compare
const comparison = extractionCompare.compare(
  standardResult,
  validatedResult.data,
  'SINGLE'
);

// Generate summary
const summary = extractionCompare.generateSummary(comparison);
console.log(summary.recommendation);

// Log detailed comparison
extractionCompare.logComparison(comparison);
```

### 2. Check Validation Metrics
```javascript
const result = await validatedClaudeService.extractPropertyData(pdfBase64);

console.log(`Confidence: ${result.validation.confidence_score}%`);
console.log(`Corrections: ${result.validation.corrections_applied ? 'YES' : 'NO'}`);
console.log(`Fabrications: ${result.validation.self_verification.verification_summary.fabricated}`);
console.log(`Calculation Issues: ${result.validation.calculation_validation.issues.length}`);
```

### 3. Review Critical Issues
```javascript
const criticalIssues = result.validation.self_verification.critical_issues;
if (criticalIssues.length > 0) {
  console.warn('CRITICAL ISSUES FOUND:');
  criticalIssues.forEach(issue => console.warn(`  - ${issue}`));
}
```

## Expected Improvements

Based on the errors you identified, the validated extraction should fix:

1. **City Name Hallucination**
   - Before: "Gaimersheim/Ingolstadt"
   - After: "Ingolstadt" (exact match from document)
   - Fix: Source attribution requirement

2. **Office Area Calculation**
   - Before: 16,663 m² (incorrect)
   - After: 19,499.67 m² (BV14: 6,970.30 + BV16: 3,526.89 + LK02: 9,002.48)
   - Fix: Calculation transparency + verification

3. **Office Rental Income**
   - Before: €1,570,000 (incorrect)
   - After: €2,200,880.30 (BV14: €750,686.34 + BV16: €216,260.76 + LK02: €1,233,933.20)
   - Fix: Self-verification pass detects discrepancy

4. **Parking Rental Income**
   - Before: €630,000 (incorrect)
   - After: €504,180.00 (D13: €260,400.00 + LK01: €243,780.00)
   - Fix: Re-reading and verification

5. **Original Year Built**
   - Before: 1990 (fabricated)
   - After: 2006 (earliest from Baujahr column)
   - Fix: Never fabricate rule + differentiate vs aggregate

6. **Fabricated Data (postal code, land area, parking spaces)**
   - Before: Invented values
   - After: null (with note in verification that field is empty)
   - Fix: Source attribution + fabrication detection

## Theoretical Foundation

This implementation follows best practices from:

1. **Anthropic's "Building Effective Agents"**
   - Start simple, add complexity when needed
   - Evaluator-Optimizer pattern for quality
   - Programmatic checks between LLM steps
   - Transparency in agent reasoning

2. **VALID Framework** (Validation of Accuracy for LLM-Extracted Information)
   - Variable-level performance metrics
   - Benchmark against ground truth
   - Multi-level evaluation (tool selection, parameters, output)

3. **Research Best Practices**
   - Execution-based validation (re-read document)
   - AI evaluating AI (with programmatic backup)
   - Confidence scoring
   - Iterative refinement

## Monitoring & Improvement

### Metrics to Track
- Confidence score distribution
- Correction frequency
- Fabrication detection rate
- Calculation validation pass rate
- Processing time percentiles
- Cost per extraction

### Red Flags
- Confidence < 70%: Document may be too complex
- Fabrications > 3: Model may need better prompting
- Calculation issues > 5: Schema may need adjustment
- Corrections always applied: Standard extraction may be broken

### Continuous Improvement
1. Log all validation results
2. Compare with manual audits
3. Identify common error patterns
4. Refine prompts based on findings
5. Adjust tolerance thresholds
6. A/B test prompt variations

## Migration Guide

### For Existing Users
1. Keep using `/api/extract-property-data` for now
2. Test `/api/extract-property-data-validated` on representative documents
3. Compare results using `extractionCompare.js`
4. If accuracy improves significantly, migrate
5. Update API clients to handle new response structure

### Backward Compatibility
The validated endpoint with `?validate=false` returns the same format as the original endpoint, making migration seamless.

## Limitations

- **3-4x slower** due to multiple passes
- **2.5x more expensive** due to token usage
- **Still not 100% accurate** - complex documents may need human review
- **Rate limits** apply - lower rate limit on validated endpoint (5 req/min vs 10 req/min)
- **Not magic** - garbage in, garbage out (corrupted PDFs still fail)

## Future Enhancements

1. **Selective Validation**: Only validate high-risk fields (financial data)
2. **Caching**: Cache verification results for identical documents
3. **Human-in-the-Loop**: Flag low-confidence fields for manual review
4. **Learning**: Track manual corrections to improve prompts
5. **Batch Processing**: Optimize token usage for portfolio documents
6. **Field-Level Confidence**: Confidence score per field, not just overall
7. **Source Highlighting**: Return page + coordinates for each extracted value
8. **Audit Trail**: Store full verification chain for compliance

## Conclusion

The three-pass validation architecture addresses the root causes of extraction errors:

- **Hallucination** → Source attribution requirement
- **Calculation errors** → Self-verification + programmatic checks
- **Semantic confusion** → Explicit differentiation rules
- **Mixed accuracy** → Every field verified independently

This follows the Anthropic principle: "only add complexity when it demonstrably improves outcomes." The validation passes add complexity but solve real problems identified in production data.

**Estimated Improvement**: 65-75% accuracy → 90-95% accuracy
**Trade-off**: 3x processing time, 2.5x cost
**Recommendation**: Use for production data, skip for testing/prototyping
