const logger = require('./logger');

class PropertyDataValidator {
  validatePropertyData(data) {
    const warnings = [];
    const errors = [];

    try {
      if (Array.isArray(data)) {
        return this.validatePortfolio(data);
      } else if (typeof data === 'object' && data !== null) {
        return this.validateSingleProperty(data);
      } else {
        errors.push('Data must be an object (single property) or array (portfolio)');
        return { valid: false, errors, warnings };
      }
    } catch (error) {
      logger.error('Validation error:', error);
      errors.push(`Validation failed: ${error.message}`);
      return { valid: false, errors, warnings };
    }
  }

  validateSingleProperty(property) {
    const warnings = [];
    const errors = [];

    if (!property.property_identity) {
      errors.push('Missing property_identity section');
    } else {
      if (!property.property_identity.city) {
        warnings.push('Missing city in property_identity');
      }
      if (!property.property_identity.postal_code) {
        warnings.push('Missing postal_code in property_identity');
      }
      if (!property.property_identity.streets || property.property_identity.streets.length === 0) {
        warnings.push('Missing or empty streets array in property_identity');
      }
    }

    if (!property.property_metrics) {
      warnings.push('Missing property_metrics section');
    } else {
      if (typeof property.property_metrics.total_usable_area_sqm !== 'number') {
        warnings.push('total_usable_area_sqm should be a number');
      }
      if (property.property_metrics.breakdown_by_use) {
        const breakdown = property.property_metrics.breakdown_by_use;
        const validKeys = ['office_sqm', 'retail_sqm', 'gastronomy_sqm', 'residential_sqm', 'parking_sqm', 'other_sqm'];
        Object.keys(breakdown).forEach(key => {
          if (!validKeys.includes(key)) {
            warnings.push(`Unknown usage type in breakdown: ${key}`);
          }
        });
      }
    }

    if (!property.financial) {
      warnings.push('Missing financial section');
    } else {
      if (typeof property.financial.total_rental_income_annual_eur !== 'number') {
        warnings.push('total_rental_income_annual_eur should be a number');
      }
    }

    if (property.usage_details) {
      if (property.usage_details.overall_occupancy_percent) {
        const occupancy = property.usage_details.overall_occupancy_percent;
        if (occupancy < 0 || occupancy > 100) {
          warnings.push(`Invalid occupancy rate: ${occupancy}% (should be 0-100)`);
        }
      }
    }

    if (property.project_details) {
      if (property.project_details.original_year_built) {
        const year = property.project_details.original_year_built;
        const currentYear = new Date().getFullYear();
        if (year < 1800 || year > currentYear + 10) {
          warnings.push(`Unlikely year_built value: ${year}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  validatePortfolio(portfolio) {
    const warnings = [];
    const errors = [];

    if (!Array.isArray(portfolio)) {
      errors.push('Portfolio data must be an array');
      return { valid: false, errors, warnings };
    }

    if (portfolio.length === 0) {
      warnings.push('Portfolio array is empty');
    }

    portfolio.forEach((property, index) => {
      if (!property.name_id) {
        warnings.push(`Property at index ${index} missing name_id`);
      }
      if (!property.city) {
        warnings.push(`Property at index ${index} missing city`);
      }
      if (!property.postal_code) {
        warnings.push(`Property at index ${index} missing postal_code`);
      }
      if (!property.street) {
        warnings.push(`Property at index ${index} missing street`);
      }

      if (typeof property.rental_income_annual_eur !== 'number' && property.rental_income_annual_eur !== null) {
        warnings.push(`Property "${property.name_id || index}" has invalid rental_income_annual_eur`);
      }

      if (property.occupancy_rate_percent !== null) {
        const occupancy = property.occupancy_rate_percent;
        if (typeof occupancy === 'number' && (occupancy < 0 || occupancy > 100)) {
          warnings.push(`Property "${property.name_id || index}" has invalid occupancy: ${occupancy}%`);
        }
      }

      if (property.year_built !== null) {
        const year = property.year_built;
        const currentYear = new Date().getFullYear();
        if (typeof year === 'number' && (year < 1800 || year > currentYear + 10)) {
          warnings.push(`Property "${property.name_id || index}" has unlikely year_built: ${year}`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  sanitizeNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const germanFormatted = value.replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(germanFormatted);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  sanitizePropertyData(data) {
    if (Array.isArray(data)) {
      return data.map(property => this.sanitizeProperty(property));
    } else {
      return this.sanitizeSingleComplexProperty(data);
    }
  }

  sanitizeProperty(property) {
    const sanitized = { ...property };

    ['land_area_sqm', 'usable_area_sqm', 'rental_income_annual_eur'].forEach(field => {
      if (sanitized[field] !== undefined) {
        sanitized[field] = this.sanitizeNumber(sanitized[field]);
      }
    });

    if (sanitized.occupancy_rate_percent !== undefined) {
      sanitized.occupancy_rate_percent = this.sanitizeNumber(sanitized.occupancy_rate_percent);
    }

    if (sanitized.year_built !== undefined && sanitized.year_built !== null) {
      sanitized.year_built = parseInt(sanitized.year_built, 10);
    }

    return sanitized;
  }

  sanitizeSingleComplexProperty(property) {
    const sanitized = JSON.parse(JSON.stringify(property));

    if (sanitized.property_metrics) {
      ['land_area_sqm', 'total_usable_area_sqm'].forEach(field => {
        if (sanitized.property_metrics[field] !== undefined) {
          sanitized.property_metrics[field] = this.sanitizeNumber(sanitized.property_metrics[field]);
        }
      });

      if (sanitized.property_metrics.breakdown_by_use) {
        Object.keys(sanitized.property_metrics.breakdown_by_use).forEach(key => {
          sanitized.property_metrics.breakdown_by_use[key] =
            this.sanitizeNumber(sanitized.property_metrics.breakdown_by_use[key]);
        });
      }
    }

    if (sanitized.financial) {
      ['total_rental_income_annual_eur', 'potential_rental_income_annual_eur'].forEach(field => {
        if (sanitized.financial[field] !== undefined) {
          sanitized.financial[field] = this.sanitizeNumber(sanitized.financial[field]);
        }
      });

      if (sanitized.financial.breakdown_by_use) {
        Object.keys(sanitized.financial.breakdown_by_use).forEach(key => {
          sanitized.financial.breakdown_by_use[key] =
            this.sanitizeNumber(sanitized.financial.breakdown_by_use[key]);
        });
      }
    }

    return sanitized;
  }
}

module.exports = new PropertyDataValidator();