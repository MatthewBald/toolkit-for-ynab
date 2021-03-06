import { i10n } from 'toolkit/extension/utils/toolkit';
import { getEntityManager } from 'toolkit/extension/utils/ynab';
import { Feature } from 'toolkit/extension/features/feature';
import { currentRouteIsBudgetPage, getSidebarViewModel } from 'toolkit/extension/utils/ynab';
import { formatCurrency } from 'toolkit/extension/utils/currency';

export class DaysOfBuffering extends Feature {
  _lookbackMonths = parseInt(ynabToolKit.options.DaysOfBufferingHistoryLookup);
  _lookbackDays = this._lookbackMonths * 30;

  injectCSS() { return require('./index.css'); }

  shouldInvoke() {
    return currentRouteIsBudgetPage() && !document.querySelector('toolkit-days-of-buffering');
  }

  invoke() {
    const elligibleTransactions = getEntityManager().getAllTransactions().filter(this._elligibleTransactionFilter);
    const onBudgetBalance = getSidebarViewModel().getOnBudgetAccountsBalance();
    const calcuation = this._calculateDaysOfBuffering(onBudgetBalance, elligibleTransactions);
    this._updateDisplay(calcuation);
  }

  onRouteChanged() {
    if (this.shouldInvoke()) {
      this.invoke();
    }
  }

  _updateDisplay(calcuation) {
    const { averageDailyOutflow, daysOfBuffering, totalDays, totalOutflow } = calcuation;
    const daysOfBufferingContainer = document.querySelector('.toolkit-days-of-buffering');
    let $displayElement = $(daysOfBufferingContainer);
    if (!daysOfBufferingContainer) {
      $displayElement = $('<div>', { class: 'budget-header-item budget-header-days toolkit-days-of-buffering' })
        .append($('<div>', {
          class: 'budget-header-days-age',
          title: i10n('budget.dob.tooltip', 'Don\'t like AoM? Try this out instead!')
        }))
        .append($('<div>', {
          class: 'budget-header-days-label',
          text: i10n('budget.dob.title', 'Days of Buffering'),
          title: i10n('budget.dob.tooltip', 'Don\'t like AoM? Try this out instead!')
        }));

      $('.budget-header-flexbox').append($displayElement);
    }

    if (calcuation.notEnoughDates) {
      $('.budget-header-days-age', $displayElement).text('???');
      $('.budget-header-days-age', $displayElement).attr('title', i10n('budget.dob.noHistory', 'Your budget history is less than 15 days. Go on with YNAB a while.'));
    } else {
      const dayText = daysOfBuffering === 1.0 ? i10n('budget.ageOfMoneyDays.one', 'day') : i10n('budget.ageOfMoneyDays.other', 'days');
      $('.budget-header-days-age', $displayElement).text(`${daysOfBuffering} ${dayText}`);
      $('.budget-header-days-age', $displayElement).attr('title', `${i10n('budget.dob.outflow', 'Total outflow')}: ${formatCurrency(totalOutflow)}
${i10n('budget.dob.days', 'Total days of budgeting')}: ${totalDays}
${i10n('budget.dob.avgOutflow', 'Average daily outflow')}: ~${formatCurrency(averageDailyOutflow)}`);
    }
  }

  _calculateDaysOfBuffering = (balance, transactions) => {
    const { dates, totalOutflow, uniqueDates } = transactions.reduce((reduced, current) => {
      const { amount, date } = current.getProperties('amount', 'date');
      reduced.dates.push(date.toUTCMoment());
      reduced.uniqueDates.set(date.format());
      reduced.totalOutflow += amount;
      return reduced;
    }, { dates: [], totalOutflow: 0, uniqueDates: new Map() });

    const minDate = moment.min(dates);
    const maxDate = moment.max(dates);
    const availableDates = maxDate.diff(minDate, 'days');

    let averageDailyOutflow;
    if (this._lookbackDays !== 0) {
      averageDailyOutflow = Math.abs(totalOutflow / this._lookbackDays);
    } else {
      averageDailyOutflow = Math.abs(totalOutflow / availableDates);
    }

    let daysOfBuffering = balance / averageDailyOutflow;
    if (daysOfBuffering < 10) {
      daysOfBuffering = daysOfBuffering.toFixed(1);
    } else {
      daysOfBuffering = Math.floor(daysOfBuffering);
    }

    const notEnoughDates = uniqueDates.size < 15;
    if (notEnoughDates) {
      daysOfBuffering = null;
    }

    return {
      averageDailyOutflow,
      daysOfBuffering,
      notEnoughDates,
      totalDays: dates.size,
      totalOutflow
    };
  }

  _elligibleTransactionFilter = (transaction) => {
    const today = new ynab.utilities.DateWithoutTime();

    let isElligibleDate = false;
    if (this._lookbackDays === 0) {
      isElligibleDate = true;
    } else {
      isElligibleDate = transaction.get('date').daysApart(today) < this._lookbackDays;
    }

    return (
      isElligibleDate &&
      !transaction.get('isTombstone') &&
      !transaction.get('payee.isInternal') &&
      !transaction.isTransferTransaction() &&
      transaction.get('account.onBudget') &&
      transaction.get('amount') < 0
    );
  }
}
