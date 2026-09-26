import { ChartRecommendation } from '../types/index.js';

export class VisualizationService {
  /**
   * Automatically determines the optimal chart representation for query results.
   */
  public analyzeAndRecommendChart(
    columns: string[],
    rows: Record<string, any>[],
    naturalLanguageQuery: string
  ): ChartRecommendation {
    if (!rows || rows.length === 0 || columns.length < 2) {
      return {
        type: 'none',
        title: 'Tabular Data',
        description: 'Single column or empty result set; tabular view recommended.',
      };
    }

    // Identify numeric columns vs string/category columns
    const numericColumns: string[] = [];
    const nonNumericColumns: string[] = [];

    const sampleRow = rows[0];
    for (const col of columns) {
      const val = sampleRow[col];
      const isNum = typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== '' && typeof val !== 'boolean');
      // Ignore ID columns for metrics
      if (isNum && !col.toLowerCase().endsWith('_id') && col.toLowerCase() !== 'id') {
        numericColumns.push(col);
      } else {
        nonNumericColumns.push(col);
      }
    }

    // If there are no numeric values to plot, no chart is suitable
    if (numericColumns.length === 0) {
      return {
        type: 'none',
        title: 'Tabular Data',
        description: 'Result contains only categorical or identifier records.',
      };
    }

    const q = naturalLanguageQuery.toLowerCase();
    const primaryCategory = nonNumericColumns[0] || columns[0];
    const primaryMetric = numericColumns[0];

    // Too many rows for a clean chart (e.g. > 50 individual records)
    if (rows.length > 50 && !q.includes('average') && !q.includes('distribution') && !q.includes('compare')) {
      return {
        type: 'none',
        title: 'Detailed Tabular Data',
        description: 'Data set contains numerous individual records, best viewed in table format.',
      };
    }

    // Pie chart: <= 8 categories, questions about distribution/breakdown/share
    if (
      rows.length <= 8 &&
      rows.length >= 2 &&
      (q.includes('share') || q.includes('distribution') || q.includes('breakdown') || q.includes('proportion') || q.includes('each department') || q.includes('by department'))
    ) {
      return {
        type: 'pie',
        xAxisKey: primaryCategory,
        yAxisKey: primaryMetric,
        title: `${this.formatTitle(primaryMetric)} Distribution`,
        description: `Visual breakdown across ${primaryCategory}.`,
      };
    }

    // Line / Area chart: time-based, trends, semester progression, or dates
    const dateCol = nonNumericColumns.find(c =>
      c.toLowerCase().includes('date') ||
      c.toLowerCase().includes('year') ||
      c.toLowerCase().includes('month') ||
      c.toLowerCase().includes('semester')
    );

    if (dateCol || q.includes('trend') || q.includes('over time') || q.includes('progression')) {
      return {
        type: q.includes('area') || q.includes('cumulative') ? 'area' : 'line',
        xAxisKey: dateCol || primaryCategory,
        yAxisKey: primaryMetric,
        seriesKeys: numericColumns.slice(0, 3),
        title: `${this.formatTitle(primaryMetric)} Progression`,
        description: `Trend comparison plotted against ${dateCol || primaryCategory}.`,
      };
    }

    // Bar chart: standard comparisons (e.g., student count, average CGPA, attendance %)
    return {
      type: 'bar',
      xAxisKey: primaryCategory,
      yAxisKey: primaryMetric,
      seriesKeys: numericColumns.slice(0, 2),
      title: `${this.formatTitle(primaryMetric)} by ${this.formatTitle(primaryCategory)}`,
      description: `Comparative chart showing ${primaryMetric} across ${primaryCategory}.`,
    };
  }

  private formatTitle(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }
}

export const visualizationService = new VisualizationService();
