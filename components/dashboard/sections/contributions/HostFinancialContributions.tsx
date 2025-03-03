import React from 'react';
import { gql, useQuery } from '@apollo/client';
import { PlusIcon } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import { z } from 'zod';

import { Views } from '../../../../lib/filters/filter-types';
import { API_V2_CONTEXT } from '../../../../lib/graphql/helpers';
import { OrderStatus } from '../../../../lib/graphql/types/v2/graphql';
import useLoggedInUser from '../../../../lib/hooks/useLoggedInUser';
import { usePrevious } from '../../../../lib/hooks/usePrevious';
import useQueryFilter from '../../../../lib/hooks/useQueryFilter';

import { confirmContributionFieldsFragment } from '../../../ContributionConfirmationModal';
import { Flex } from '../../../Grid';
import CreatePendingOrderModal from '../../../host-dashboard/CreatePendingOrderModal';
import MessageBoxGraphqlError from '../../../MessageBoxGraphqlError';
import OrdersList from '../../../orders/OrdersList';
import Pagination from '../../../Pagination';
import { Button } from '../../../ui/Button';
import DashboardHeader from '../../DashboardHeader';
import { EmptyResults } from '../../EmptyResults';
import { Filterbar } from '../../filters/Filterbar';
import { DashboardSectionProps } from '../../types';

import { filters, schema, toVariables } from './filters';

const accountOrdersQuery = gql`
  query HostContributions(
    $hostSlug: String
    $limit: Int!
    $offset: Int!
    $status: [OrderStatus]
    $minAmount: Int
    $maxAmount: Int
    $dateFrom: DateTime
    $dateTo: DateTime
    $searchTerm: String
    $orderBy: ChronologicalOrderInput
    $frequency: ContributionFrequency
  ) {
    orders(
      account: { slug: $hostSlug }
      includeHostedAccounts: true
      filter: INCOMING
      status: $status
      searchTerm: $searchTerm
      limit: $limit
      offset: $offset
      dateFrom: $dateFrom
      dateTo: $dateTo
      minAmount: $minAmount
      maxAmount: $maxAmount
      orderBy: $orderBy
      frequency: $frequency
    ) {
      totalCount
      nodes {
        id
        legacyId
        description
        createdAt
        status
        ...ConfirmContributionFields
        paymentMethod {
          id
          providerType
        }
        fromAccount {
          id
          slug
          name
          imageUrl
          type
        }
        pendingContributionData {
          expectedAt
          paymentMethod
          ponumber
          memo
          fromAccountInfo {
            name
            email
          }
        }
        toAccount {
          id
          slug
          name
          imageUrl
          type
          isHost
          ... on AccountWithHost {
            bankTransfersHostFeePercent: hostFeePercent(paymentMethodType: MANUAL)
          }
        }
        permissions {
          id
          canMarkAsExpired
          canMarkAsPaid
        }
      }
    }
  }
  ${confirmContributionFieldsFragment}
`;

const accountOrdersMetaDataQuery = gql`
  query OrdersMetaData($hostSlug: String) {
    account(slug: $hostSlug) {
      id
      slug
      currency
      legacyId
      name
      isHost
    }
    all: orders(account: { slug: $hostSlug }, includeHostedAccounts: true, filter: INCOMING, limit: 0) {
      totalCount
    }
    pending: orders(
      account: { slug: $hostSlug }
      includeHostedAccounts: true
      filter: INCOMING
      status: PENDING
      limit: 0
    ) {
      totalCount
    }
    disputed: orders(
      account: { slug: $hostSlug }
      includeHostedAccounts: true
      filter: INCOMING
      status: DISPUTED
      limit: 0
    ) {
      totalCount
    }
    in_review: orders(
      account: { slug: $hostSlug }
      includeHostedAccounts: true
      filter: INCOMING
      status: IN_REVIEW
      limit: 0
    ) {
      totalCount
    }
  }
`;

const ROUTE_PARAMS = ['hostCollectiveSlug', 'collectiveSlug', 'view', 'slug', 'section'];

const HostFinancialContributions = ({ accountSlug: hostSlug }: DashboardSectionProps) => {
  const intl = useIntl();
  const [showCreatePendingOrderModal, setShowCreatePendingOrderModal] = React.useState(false);

  const { data: metaData, refetch: refetchMetaData } = useQuery(accountOrdersMetaDataQuery, {
    variables: { hostSlug },
    context: API_V2_CONTEXT,
  });

  const views: Views<z.infer<typeof schema>> = [
    {
      label: intl.formatMessage({ defaultMessage: 'All' }),
      filter: {},
      id: 'all',
      count: metaData?.all?.totalCount,
    },
    {
      label: intl.formatMessage({ defaultMessage: 'Pending' }),
      filter: { status: [OrderStatus.PENDING] },
      count: metaData?.pending?.totalCount,
      id: 'pending',
    },
    {
      label: intl.formatMessage({ defaultMessage: 'Disputed' }),
      filter: { status: [OrderStatus.DISPUTED] },
      count: metaData?.disputed?.totalCount,
      id: 'disputed',
    },
    {
      label: intl.formatMessage({ id: 'order.in_review', defaultMessage: 'In Review' }),
      filter: { status: [OrderStatus.IN_REVIEW] },
      count: metaData?.in_review?.totalCount,
      id: 'in_review',
    },
  ];

  const queryFilter = useQueryFilter({
    schema,
    toVariables,
    filters,
    views,
    meta: {
      currency: metaData?.account?.currency,
    },
  });

  const { data, error, loading, variables, refetch } = useQuery(accountOrdersQuery, {
    variables: { hostSlug, ...queryFilter.variables },
    context: API_V2_CONTEXT,
  });

  const { LoggedInUser } = useLoggedInUser();
  const prevLoggedInUser = usePrevious(LoggedInUser);

  // Refetch data when user logs in
  React.useEffect(() => {
    if (!prevLoggedInUser && LoggedInUser) {
      refetch();
    }
  }, [LoggedInUser]);

  return (
    <div className="flex w-full flex-col gap-4">
      <DashboardHeader
        title={<FormattedMessage id="FinancialContributions" defaultMessage="Financial Contributions" />}
        description={<FormattedMessage defaultMessage="Contributions for Collectives you host." />}
        actions={
          <React.Fragment>
            <Button
              size="sm"
              onClick={() => setShowCreatePendingOrderModal(true)}
              className="gap-1 "
              data-cy="create-pending-contribution"
            >
              <span>
                <FormattedMessage defaultMessage="Create pending" />
              </span>
              <PlusIcon size={20} />
            </Button>
            {showCreatePendingOrderModal && (
              <CreatePendingOrderModal
                hostSlug={hostSlug}
                onClose={() => setShowCreatePendingOrderModal(false)}
                onSuccess={() => {
                  refetch();
                  refetchMetaData();
                }}
              />
            )}
          </React.Fragment>
        }
      />
      <Filterbar {...queryFilter} />

      {error ? (
        <MessageBoxGraphqlError error={error} />
      ) : !loading && !data.orders?.nodes.length ? (
        <EmptyResults
          entityType="CONTRIBUTIONS"
          hasFilters={queryFilter.hasFilters}
          onResetFilters={() => queryFilter.resetFilters({})}
        />
      ) : (
        <React.Fragment>
          <OrdersList
            isLoading={loading}
            orders={data?.orders?.nodes}
            nbPlaceholders={variables.limit}
            showPlatformTip
          />
          <Flex mt={5} justifyContent="center">
            <Pagination
              total={data?.orders?.totalCount}
              limit={variables.limit}
              offset={variables.offset}
              ignoredQueryParams={ROUTE_PARAMS}
            />
          </Flex>
        </React.Fragment>
      )}
    </div>
  );
};

export default HostFinancialContributions;
