import React from 'react';
import { useQuery } from '@apollo/client';
import { omit } from 'lodash';
import { useRouter } from 'next/router';
import { defineMessage, FormattedMessage } from 'react-intl';
import { z } from 'zod';

import { FilterComponentConfigs, FiltersToVariables } from '../../../../lib/filters/filter-types';
import { API_V2_CONTEXT } from '../../../../lib/graphql/helpers';
import { Account, ExpensesPageQueryVariables } from '../../../../lib/graphql/types/v2/graphql';
import useQueryFilter from '../../../../lib/hooks/useQueryFilter';

import ExpensesList from '../../../expenses/ExpensesList';
import Pagination from '../../../Pagination';
import DashboardHeader from '../../DashboardHeader';
import { EmptyResults } from '../../EmptyResults';
import ComboSelectFilter from '../../filters/ComboSelectFilter';
import { expenseTagFilter } from '../../filters/ExpenseTagsFilter';
import { Filterbar } from '../../filters/Filterbar';
import { AccountRenderer } from '../../filters/HostedAccountFilter';
import { DashboardSectionProps } from '../../types';

import {
  FilterMeta as CommonFilterMeta,
  filters as commonFilters,
  schema as commonSchema,
  toVariables as commonToVariables,
} from './filters';
import { accountExpensesMetadataQuery, accountExpensesQuery } from './queries';

const schema = commonSchema.extend({
  account: z.string().nullable().default(null),
});

type FilterValues = z.infer<typeof schema>;

type FilterMeta = CommonFilterMeta & {
  accountSlug: string;
  childrenAccounts?: Array<Account>;
  expenseTags?: string[];
};
const toVariables: FiltersToVariables<FilterValues, ExpensesPageQueryVariables, FilterMeta> = {
  ...commonToVariables,
  account: (slug, key, meta) => {
    if (!slug) {
      return { includeChildrenExpenses: true };
    } else if (meta.childrenAccounts && !meta.childrenAccounts.find(a => a.slug === slug)) {
      return { limit: 0 };
    } else {
      return { account: { slug } };
    }
  },
};

const filters: FilterComponentConfigs<FilterValues, FilterMeta> = {
  ...commonFilters,
  tag: expenseTagFilter.filter,
  account: {
    labelMsg: defineMessage({ defaultMessage: 'Account' }),
    Component: ({ meta, ...props }) => {
      return (
        <ComboSelectFilter
          options={meta.childrenAccounts.map(account => ({
            value: account.slug,
            label: <AccountRenderer account={account} />,
          }))}
          {...props}
        />
      );
    },
    valueRenderer: ({ value }) => <AccountRenderer account={{ slug: value }} />,
  },
};

const ROUTE_PARAMS = ['slug', 'section', 'subpath'];

const ReceivedExpenses = ({ accountSlug }: DashboardSectionProps) => {
  const router = useRouter();

  const { data: metadata } = useQuery(accountExpensesMetadataQuery, {
    variables: { accountSlug },
    context: API_V2_CONTEXT,
  });

  const filterMeta: FilterMeta = {
    currency: metadata?.account?.currency,
    childrenAccounts: metadata?.account?.childrenAccounts?.nodes.length
      ? [metadata.account, ...metadata.account.childrenAccounts.nodes]
      : undefined,
    accountSlug,
    expenseTags: metadata?.expenseTagStats?.nodes?.map(({ tag }) => tag),
  };

  const queryFilter = useQueryFilter({
    schema,
    toVariables,
    meta: filterMeta,
    filters,
  });

  const { data, loading } = useQuery(accountExpensesQuery, {
    variables: {
      account: { slug: accountSlug },
      ...queryFilter.variables,
    },
    context: API_V2_CONTEXT,
  });

  const pageRoute = `/dashboard/${accountSlug}/expenses`;

  return (
    <div className="flex flex-col gap-4">
      <DashboardHeader
        title={<FormattedMessage defaultMessage="Received Expenses" />}
        description={<FormattedMessage defaultMessage="Expenses submitted to your account." />}
      />
      <Filterbar {...queryFilter} />

      {!loading && !data.expenses?.nodes.length ? (
        <EmptyResults
          entityType="EXPENSES"
          onResetFilters={() => queryFilter.resetFilters({})}
          hasFilters={queryFilter.hasFilters}
        />
      ) : (
        <React.Fragment>
          <ExpensesList
            isLoading={loading}
            collective={metadata?.account}
            host={metadata?.account?.isHost ? metadata?.account : metadata?.account?.host}
            expenses={data?.expenses?.nodes}
            nbPlaceholders={queryFilter.values.limit}
            // suggestedTags={suggestedTags}
            useDrawer
            openExpenseLegacyId={Number(router.query.openExpenseId)}
            setOpenExpenseLegacyId={legacyId => {
              router.push(
                {
                  pathname: pageRoute,
                  query: { ...omit(router.query, ROUTE_PARAMS), openExpenseId: legacyId },
                },
                undefined,
                { shallow: true },
              );
            }}
          />
          <div className="mt-12 flex justify-center">
            <Pagination
              route={pageRoute}
              total={data?.expenses?.totalCount}
              limit={queryFilter.values.limit}
              offset={queryFilter.values.offset}
              ignoredQueryParams={ROUTE_PARAMS}
            />
          </div>
        </React.Fragment>
      )}
    </div>
  );
};

export default ReceivedExpenses;
