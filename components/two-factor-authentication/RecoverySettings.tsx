import React from 'react';
import { gql, useMutation } from '@apollo/client';
import { CheckCircle2Icon } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';

import { i18nGraphqlException } from '../../lib/errors';
import { API_V2_CONTEXT } from '../../lib/graphql/helpers';

import ConfirmationModal from '../ConfirmationModal';
import { Box, Flex } from '../Grid';
import MessageBox from '../MessageBox';
import StyledButton from '../StyledButton';
import StyledCard from '../StyledCard';
import { H3 } from '../Text';
import { useToast } from '../ui/useToast';

const regenerateRecoveryCodesMutation = gql`
  mutation RegenerateRecoveryCodes {
    regenerateRecoveryCodes
  }
`;

type RecoverySettingsProps = {
  onRecoveryCodes: (recoveryCodes: string[]) => void;
};

export function RecoverySettings(props: RecoverySettingsProps) {
  const intl = useIntl();
  const { toast } = useToast();
  const [isRegenetingRecoveryCodes, setIsRegenetingRecoveryCodes] = React.useState(false);

  const [regenerateRecoveryCodes, { loading }] = useMutation<{ regenerateRecoveryCodes: string[] }>(
    regenerateRecoveryCodesMutation,
    {
      context: API_V2_CONTEXT,
    },
  );

  const onRegenerateConfirmation = React.useCallback(async () => {
    try {
      const res = await regenerateRecoveryCodes();
      setIsRegenetingRecoveryCodes(false);
      props.onRecoveryCodes(res.data.regenerateRecoveryCodes);
    } catch (err) {
      toast({ variant: 'error', message: i18nGraphqlException(intl, err) });
    }
  }, [intl, props.onRecoveryCodes]);

  return (
    <React.Fragment>
      <StyledCard px={3} py={2}>
        <Flex alignItems="center">
          <Box mr={3}>{<CheckCircle2Icon color="#0EA755" />}</Box>
          <H3 fontSize="14px" fontWeight="700">
            <FormattedMessage defaultMessage="Recovery" />
          </H3>
        </Flex>
        <div className="border-b pb-3 text-sm">
          <FormattedMessage defaultMessage="Recovery codes can be used to access you account in case you lose access to your other two factor methods." />
        </div>
        <div className="mt-3 flex gap-2">
          <StyledButton
            loading={loading}
            onClick={() => setIsRegenetingRecoveryCodes(true)}
            buttonSize="tiny"
            buttonStyle="secondary"
          >
            <FormattedMessage defaultMessage="Regenerate" />
          </StyledButton>
        </div>
      </StyledCard>
      {isRegenetingRecoveryCodes && (
        <ConfirmationModal
          isDanger
          onClose={() => setIsRegenetingRecoveryCodes(false)}
          header={<FormattedMessage defaultMessage="Are you sure you want to regenerate your recovery codes?" />}
          continueHandler={onRegenerateConfirmation}
        >
          <MessageBox type="warning" withIcon>
            <FormattedMessage defaultMessage="This will inactive your previous recovery codes." />
          </MessageBox>
        </ConfirmationModal>
      )}
    </React.Fragment>
  );
}
