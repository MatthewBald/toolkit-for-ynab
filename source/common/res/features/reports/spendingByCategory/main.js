(function poll() {
  if (typeof ynabToolKit !== 'undefined' && typeof Highcharts !== 'undefined') {
    ynabToolKit.spendingByCategory = (function () {
      let colors = ['#ea5439', '#f3ad51', '#ebe598', '#74a9e6', '#c8df68', '#8ba157', '#91c5b4', '#009dae', '#cbdb3c'];
      let reportData = {
        masterCategories: {}
      };

      function placeInSubCategory(transaction, masterCategoryData, categoryViewModel) {
        // grab the sub category id the data for it inside of our nested object
        let subCategoryId = transaction.get('subCategoryId');
        let subCategoryData = masterCategoryData.subCategories[subCategoryId];

        // if we haven't created that data yet, then default everything to 0/empty
        if (typeof subCategoryData === 'undefined') {
          masterCategoryData.subCategories[subCategoryId] = {
            internalData: categoryViewModel.getSubCategoryById(subCategoryId),
            total: 0,
            transactions: []
          };

          subCategoryData = masterCategoryData.subCategories[subCategoryId];
        }

        // push the transaction and increment the total. storing the transaction just because
        // we might want it for the drilldown stuff. not certain yet.
        subCategoryData.transactions.push(transaction);
        subCategoryData.total += transaction.get('outflow');
      }

      function placeInMasterCategory(transaction, categoryViewModel) {
        // grab the master category date from our master category object
        let masterCategoryId = transaction.get('masterCategoryId');
        let masterCategoryData = reportData.masterCategories[masterCategoryId];

        // if we haven't created that data yet, then default everything to 0/empty
        if (typeof masterCategoryData === 'undefined') {
          reportData.masterCategories[masterCategoryId] = {
            internalData: categoryViewModel.getMasterCategoryById(masterCategoryId),
            subCategories: {},
            total: 0
          };

          masterCategoryData = reportData.masterCategories[masterCategoryId];
        }

        // increment the total of the category and then call placeInSubCategory so that we can do drilldowns
        masterCategoryData.total += transaction.get('outflow');
        placeInSubCategory(transaction, masterCategoryData, categoryViewModel);
      }

      return {
        availableAccountTypes: 'onbudget',
        reportHeaders() {
          return '';
        },

        // custom data filter for our transactions. YNAB has a debt master category and an internal master category
        // which I'm pretty sure stores credit card transfer stuff and things like "Split (Multiple Categories...)"
        // type transactions. we ignore these guys because they will throw off numbers! we also ignore inflows and transfers
        // because this is a "spending" by category report and neither of those are "spending" right? I think that's right.
        filterTransaction(transaction) {
          // can't use a promise here and the _result *should* if there's anything to worry about, it's this line
          // but im still not worried about it.
          let categoriesViewModel = ynab.YNABSharedLib.getBudgetViewModel_CategoriesViewModel()._result;
          let masterCategoryId = transaction.get('masterCategoryId');
          let subCategoryId = transaction.get('subCategoryId');
          let isTransfer = masterCategoryId === null || subCategoryId === null;
          let internalMasterCategory = categoriesViewModel.getMasterCategoryById(masterCategoryId);
          let isInternalYNABCategory = isTransfer ? false :
                                       internalMasterCategory.isDebtPaymentMasterCategory() ||
                                       internalMasterCategory.isInternalMasterCategory();

          return !transaction.get('inflow') && !isTransfer && !isInternalYNABCategory;
        },

        calculate(transactions) {
          // make sure the data is empty before we start doing an calculating/data layout stuff
          reportData.masterCategories = {};

          return new Promise((resolve) => {
            // grab the categories from ynab's shared lib with their promise -- we can trust it.
            ynab.YNABSharedLib.getBudgetViewModel_CategoriesViewModel().then((categoryViewModel) => {
              transactions.forEach((transaction) => {
                placeInMasterCategory(transaction, categoryViewModel);
              });

              resolve();
            });
          });
        },

        createChart($reportsData) {
          // set up the container for our graph and for our side-panel (the legend)
          $reportsData.css({
            display: 'inline-flex'
          }).html($(
           `<div class="ynabtk-spending-by-cat-chart-container">
              <div id="report-chart" style="position: relative; height: 100%"></div>
            </div>
            <div class="ynabtk-category-panel">
              <div class="ynabtk-category-entry">
                <div class="ynabtk-category-entry-name">Category</div>
                <div class="ynabtk-category-entry-amount">Spending</div>
              </div>
              <hr>
            </div>`
          ));

          // store all the categories into an array so we can sort it!
          let masterCategoriesArray = [];
          for (let categoryId in reportData.masterCategories) {
            masterCategoriesArray.push(reportData.masterCategories[categoryId]);
          }

          // sort it! (descending)
          masterCategoriesArray.sort((a, b) => {
            return b.total - a.total;
          });

          // we want to have a separate chartData array because there's only 10 slices in this pie
          let chartData = [];
          let totalSpending = 0;

          // the 10th will be a house for everything not in the top 9 slices...
          let otherCategories = {
            name: 'All Other Categories',
            y: 0,
            color: '#696a69'
          };

          // throw the categories into the chartData FILO style because that's what Highcharts wants.
          masterCategoriesArray.forEach(function (masterCategoryData, index) {
            let categoryName = masterCategoryData.internalData.get('name');
            let categoryTotal = masterCategoryData.total;
            let color = colors[index] || otherCategories.color;
            totalSpending += masterCategoryData.total;

            // the 10th data element will get grouped into "all other transactions"
            if (chartData.length < 9) {
              chartData.unshift({
                name: categoryName,
                y: categoryTotal,
                color: color
              });
            } else {
              otherCategories.y += masterCategoryData.total;
            }

            // also add the category to the legend so users can still see all the data
            $('.ynabtk-category-panel').append(
              `<div class="ynabtk-category-entry">
                <div class="ynabtk-category-entry-name">
                  <div class="ynabtk-reports-legend-square category-color" style="background-color: ${color};"></div>
                  ${categoryName}
                </div>
                <div class="ynabtk-category-entry-amount">${ynabToolKit.shared.formatCurrency(categoryTotal)}</div>
              </div>`
            );
          });

          // if we had enough data for otherCategories, make sure we put it in the chart!
          if (otherCategories.y) {
            chartData.unshift(otherCategories);
          }

          // throw the total into the legend as well so they can see how much money the spend in two places!
          $('.ynabtk-category-panel').append(
            `<hr>
             <div class="ynabtk-category-entry">
                <div class="ynabtk-category-entry-name total">Total</div>
                <div class="ynabtk-category-entry-amount total">${ynabToolKit.shared.formatCurrency(totalSpending)}</div>
             </div>`
          );

          // make that chart!
          ynabToolKit.spendingByCategory.chart = new Highcharts.Chart({
            credits: false,
            chart: {
              type: 'pie',
              renderTo: 'report-chart'
            },
            plotOptions: {
              pie: {
                startAngle: 90
              }
            },
            tooltip: {
              enabled: false
            },
            title: {
              align: 'center',
              verticalAlign: 'middle',
              text: 'Total Spending<br>' + ynabToolKit.shared.formatCurrency(totalSpending)
            },
            series: [{
              name: 'Total Spending',
              data: chartData,
              size: '80%',
              innerSize: '50%',
              dataLabels: {
                formatter: function () {
                  let formattedNumber = ynabToolKit.shared.formatCurrency(this.y);
                  return this.point.name + '<br>' + formattedNumber + ' (' + Math.round(this.percentage) + '%)';
                }
              }
            }]
          });
        }
      };
    }());
  } else {
    setTimeout(poll, 250);
  }
}());
