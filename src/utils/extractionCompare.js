const logger = require('./contextLogger');

/**
 * Utility to compare extraction results from standard vs validated services
 * Helps identify improvements in data accuracy
 */
class ExtractionComparator {
  /**
   * Compare two extraction results and generate a detailed diff report
   * @param {Object} standardResult - Result from standard extraction
   * @param {Object} validatedResult - Result from validated extraction
   * @param {String} propertyType - 'SINGLE' or 'PORTFOLIO'
   * @returns {Object} Comparison report
   */
  compare(standardResult, validatedResult, propertyType) {
    const report = {
      comparison_date: new Date().toISOString(),
      property_type: propertyType,
      differences: [],
      statistics: {
        fields_compared: 0,
        fields_different: 0,
        fields_identical: 0,
        improvement_detected: false
      },
      confidence_metrics: {
        validated_confidence: validatedResult.validation?.confidence_score || null,
        validation_issues_found: validatedResult.validation?.self_verification?.critical_issues?.length || 0,
        calculation_issues_found: validatedResult.validation?.calculation_validation?.issues?.length || 0
      }
    };

    if (propertyType === 'SINGLE') {
      this.compareSingleProperty(standardResult, validatedResult.data || validatedResult, report);
    } else {
      this.comparePortfolio(standardResult, validatedResult.data || validatedResult, report);
    }

    report.statistics.improvement_detected =
      report.differences.some(d => d.severity === 'high' || d.severity === 'critical');

    return report;
  }

  compareSingleProperty(standard, validated, report) {
    // Compare property identity
    this.compareSection(
      'property_identity',
      standard.property_identity,
      validated.property_identity,
      report,
      ['name_id', 'city', 'postal_code', 'streets']
    );

    // Compare property metrics
    if (standard.property_metrics && validated.property_metrics) {
      this.compareNumericField(
        'property_metrics.total_usable_area_sqm',
        standard.property_metrics.total_usable_area_sqm,
        validated.property_metrics.total_usable_area_sqm,
        report,
        { tolerance: 0.01 }
      );

      this.compareNumericField(
        'property_metrics.land_area_sqm',
        standard.property_metrics.land_area_sqm,
        validated.property_metrics.land_area_sqm,
        report,
        { tolerance: 0.01 }
      );

      // Compare area breakdowns
      if (standard.property_metrics.breakdown_by_use && validated.property_metrics.breakdown_by_use) {
        const standardBreakdown = standard.property_metrics.breakdown_by_use;
        const validatedBreakdown = validated.property_metrics.breakdown_by_use;
        const usageTypes = new Set([
          ...Object.keys(standardBreakdown),
          ...Object.keys(validatedBreakdown)
        ]);

        usageTypes.forEach(type => {
          this.compareNumericField(
            `property_metrics.breakdown_by_use.${type}`,
            standardBreakdown[type],
            validatedBreakdown[type],
            report,
            { tolerance: 0.01 }
          );
        });
      }
    }

    // Compare financial data
    if (standard.financial && validated.financial) {
      this.compareNumericField(
        'financial.total_rental_income_annual_eur',
        standard.financial.total_rental_income_annual_eur,
        validated.financial.total_rental_income_annual_eur,
        report,
        { tolerance: 0.01, severity: 'high' }
      );

      // Compare income breakdowns
      if (standard.financial.breakdown_by_use && validated.financial.breakdown_by_use) {
        const standardBreakdown = standard.financial.breakdown_by_use;
        const validatedBreakdown = validated.financial.breakdown_by_use;
        const usageTypes = new Set([
          ...Object.keys(standardBreakdown),
          ...Object.keys(validatedBreakdown)
        ]);

        usageTypes.forEach(type => {
          this.compareNumericField(
            `financial.breakdown_by_use.${type}`,
            standardBreakdown[type],
            validatedBreakdown[type],
            report,
            { tolerance: 0.01, severity: 'high' }
          );
        });
      }
    }

    // Compare project details
    if (standard.project_details && validated.project_details) {
      this.compareNumericField(
        'project_details.original_year_built',
        standard.project_details.original_year_built,
        validated.project_details.original_year_built,
        report,
        { tolerance: 0, severity: 'medium' }
      );

      this.compareField(
        'project_details.project_type',
        standard.project_details.project_type,
        validated.project_details.project_type,
        report,
        { severity: 'medium' }
      );
    }

    // Compare unit counts
    if (standard.unit_counts && validated.unit_counts) {
      this.compareNumericField(
        'unit_counts.parking_spaces',
        standard.unit_counts.parking_spaces,
        validated.unit_counts.parking_spaces,
        report,
        { tolerance: 0, severity: 'medium' }
      );
    }
  }

  comparePortfolio(standard, validated, report) {
    if (!Array.isArray(standard) || !Array.isArray(validated)) {
      report.differences.push({
        field: 'portfolio_structure',
        severity: 'critical',
        issue: 'One result is not an array',
        standard_type: typeof standard,
        validated_type: typeof validated
      });
      return;
    }

    if (standard.length !== validated.length) {
      report.differences.push({
        field: 'portfolio_length',
        severity: 'critical',
        issue: 'Different number of properties extracted',
        standard_count: standard.length,
        validated_count: validated.length
      });
    }

    const maxLength = Math.max(standard.length, validated.length);
    for (let i = 0; i < maxLength; i++) {
      const stdProp = standard[i];
      const valProp = validated[i];

      if (!stdProp || !valProp) {
        report.differences.push({
          field: `portfolio[${i}]`,
          severity: 'critical',
          issue: 'Property exists in one extraction but not the other',
          standard_exists: !!stdProp,
          validated_exists: !!valProp
        });
        continue;
      }

      this.compareField(`portfolio[${i}].name_id`, stdProp.name_id, valProp.name_id, report);
      this.compareField(`portfolio[${i}].city`, stdProp.city, valProp.city, report);
      this.compareNumericField(
        `portfolio[${i}].rental_income_annual_eur`,
        stdProp.rental_income_annual_eur,
        valProp.rental_income_annual_eur,
        report,
        { tolerance: 0.01, severity: 'high' }
      );
      this.compareNumericField(
        `portfolio[${i}].usable_area_sqm`,
        stdProp.usable_area_sqm,
        valProp.usable_area_sqm,
        report,
        { tolerance: 0.01 }
      );
    }
  }

  compareSection(sectionName, standard, validated, report, fields) {
    if (!standard && !validated) return;

    if (!standard || !validated) {
      report.differences.push({
        field: sectionName,
        severity: 'high',
        issue: 'Section missing in one extraction',
        standard_exists: !!standard,
        validated_exists: !!validated
      });
      return;
    }

    fields.forEach(field => {
      this.compareField(`${sectionName}.${field}`, standard[field], validated[field], report);
    });
  }

  compareField(fieldPath, standardValue, validatedValue, report, options = {}) {
    const { severity = 'low' } = options;
    report.statistics.fields_compared++;

    const standardStr = JSON.stringify(standardValue);
    const validatedStr = JSON.stringify(validatedValue);

    if (standardStr === validatedStr) {
      report.statistics.fields_identical++;
      return;
    }

    report.statistics.fields_different++;

    // Detect specific types of issues
    const issue = this.categorizeIssue(standardValue, validatedValue);

    report.differences.push({
      field: fieldPath,
      severity: issue.isFabrication ? 'critical' : severity,
      standard_value: standardValue,
      validated_value: validatedValue,
      issue_type: issue.type,
      notes: issue.notes
    });
  }

  compareNumericField(fieldPath, standardValue, validatedValue, report, options = {}) {
    const { tolerance = 0, severity = 'medium' } = options;
    report.statistics.fields_compared++;

    // Handle null values
    if (standardValue === null && validatedValue === null) {
      report.statistics.fields_identical++;
      return;
    }

    if (standardValue === null || validatedValue === null) {
      const issue = this.categorizeIssue(standardValue, validatedValue);
      report.statistics.fields_different++;
      report.differences.push({
        field: fieldPath,
        severity: issue.isFabrication ? 'critical' : severity,
        standard_value: standardValue,
        validated_value: validatedValue,
        issue_type: issue.type,
        notes: issue.notes
      });
      return;
    }

    const std = Number(standardValue);
    const val = Number(validatedValue);

    if (isNaN(std) || isNaN(val)) {
      report.statistics.fields_different++;
      report.differences.push({
        field: fieldPath,
        severity: 'medium',
        standard_value: standardValue,
        validated_value: validatedValue,
        issue_type: 'type_mismatch',
        notes: 'One or both values are not valid numbers'
      });
      return;
    }

    const diff = Math.abs(std - val);
    const percentDiff = std !== 0 ? (diff / std) * 100 : 0;

    if (diff <= tolerance) {
      report.statistics.fields_identical++;
      return;
    }

    report.statistics.fields_different++;
    report.differences.push({
      field: fieldPath,
      severity,
      standard_value: standardValue,
      validated_value: validatedValue,
      absolute_difference: diff,
      percent_difference: percentDiff.toFixed(2) + '%',
      issue_type: 'numeric_discrepancy',
      notes: diff > 1000 ? 'Large discrepancy detected' : 'Small discrepancy'
    });
  }

  categorizeIssue(standardValue, validatedValue) {
    // Fabrication detection
    if (standardValue !== null && validatedValue === null) {
      return {
        type: 'removed_fabrication',
        isFabrication: true,
        notes: 'Standard extraction may have fabricated this value (validated set to null)'
      };
    }

    if (standardValue === null && validatedValue !== null) {
      return {
        type: 'added_missing_data',
        isFabrication: false,
        notes: 'Validated extraction found data that standard extraction missed'
      };
    }

    // String modifications
    if (typeof standardValue === 'string' && typeof validatedValue === 'string') {
      if (standardValue.includes(validatedValue) || validatedValue.includes(standardValue)) {
        return {
          type: 'string_modification',
          isFabrication: false,
          notes: 'One value is a subset of the other (possible cleaning/normalization)'
        };
      }
    }

    return {
      type: 'value_change',
      isFabrication: false,
      notes: 'Value changed between extractions'
    };
  }

  /**
   * Generate a human-readable summary report
   */
  generateSummary(comparisonReport) {
    const { statistics, differences, confidence_metrics } = comparisonReport;

    const highSeverityIssues = differences.filter(d => d.severity === 'high' || d.severity === 'critical');
    const fabrications = differences.filter(d => d.issue_type === 'removed_fabrication');
    const missingData = differences.filter(d => d.issue_type === 'added_missing_data');

    const summary = {
      overview: {
        fields_compared: statistics.fields_compared,
        fields_different: statistics.fields_different,
        fields_identical: statistics.fields_identical,
        accuracy_improvement: statistics.fields_compared > 0
          ? ((statistics.fields_different / statistics.fields_compared) * 100).toFixed(2) + '%'
          : 'N/A'
      },
      critical_findings: {
        high_severity_issues: highSeverityIssues.length,
        fabrications_detected: fabrications.length,
        missing_data_found: missingData.length
      },
      validation_quality: {
        confidence_score: confidence_metrics.validated_confidence,
        self_verification_issues: confidence_metrics.validation_issues_found,
        calculation_issues: confidence_metrics.calculation_issues_found
      },
      recommendation: this.getRecommendation(comparisonReport)
    };

    return summary;
  }

  getRecommendation(comparisonReport) {
    const { differences, confidence_metrics } = comparisonReport;
    const fabrications = differences.filter(d => d.issue_type === 'removed_fabrication').length;
    const criticalIssues = differences.filter(d => d.severity === 'critical').length;

    if (fabrications > 5 || criticalIssues > 3) {
      return 'STRONGLY RECOMMENDED: Use validated extraction - standard extraction has significant accuracy issues';
    }

    if (fabrications > 2 || criticalIssues > 0) {
      return 'RECOMMENDED: Use validated extraction for improved accuracy';
    }

    if (confidence_metrics.validated_confidence && confidence_metrics.validated_confidence < 80) {
      return 'CAUTION: Both extractions may have issues - manual review recommended';
    }

    if (differences.length === 0) {
      return 'OPTIONAL: Both extractions produced identical results';
    }

    return 'CONSIDER: Validated extraction provides incremental improvements';
  }

  /**
   * Log comparison results in a formatted way
   */
  logComparison(comparisonReport) {
    const summary = this.generateSummary(comparisonReport);

    logger.info('=== EXTRACTION COMPARISON REPORT ===');
    logger.info(`Fields Compared: ${summary.overview.fields_compared}`);
    logger.info(`Differences Found: ${summary.overview.fields_different}`);
    logger.info(`Fabrications Detected: ${summary.critical_findings.fabrications_detected}`);
    logger.info(`Missing Data Found: ${summary.critical_findings.missing_data_found}`);

    if (summary.validation_quality.confidence_score) {
      logger.info(`Validated Confidence Score: ${summary.validation_quality.confidence_score}%`);
    }

    logger.info(`Recommendation: ${summary.recommendation}`);
    logger.info('===================================');

    if (comparisonReport.differences.length > 0) {
      logger.info('Top differences:');
      comparisonReport.differences.slice(0, 5).forEach(diff => {
        logger.info(`  - ${diff.field}: ${diff.issue_type} (${diff.severity})`);
        logger.info(`    Standard: ${JSON.stringify(diff.standard_value)}`);
        logger.info(`    Validated: ${JSON.stringify(diff.validated_value)}`);
      });
    }
  }
}

module.exports = new ExtractionComparator();
