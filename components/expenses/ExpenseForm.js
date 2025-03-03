import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { Undo } from '@styled-icons/fa-solid/Undo';
import { Field, FieldArray, Form, Formik } from 'formik';
import { first, isEmpty, omit, pick } from 'lodash';
import { useRouter } from 'next/router';
import { createPortal } from 'react-dom';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import styled from 'styled-components';

import { getAccountReferenceInput, isInternalHost } from '../../lib/collective.lib';
import { CollectiveType } from '../../lib/constants/collectives';
import expenseTypes from '../../lib/constants/expenseTypes';
import { PayoutMethodType } from '../../lib/constants/payout-method';
import { formatErrorMessage } from '../../lib/errors';
import { getSupportedExpenseTypes } from '../../lib/expenses';
import { requireFields } from '../../lib/form-utils';
import { ExpenseStatus } from '../../lib/graphql/types/v2/graphql';
import useLoggedInUser from '../../lib/hooks/useLoggedInUser';
import { usePrevious } from '../../lib/hooks/usePrevious';
import { AmountPropTypeShape } from '../../lib/prop-types';
import { flattenObjectDeep, parseToBoolean } from '../../lib/utils';
import { userMustSetAccountingCategory } from './lib/accounting-categories';
import { expenseTypeSupportsAttachments } from './lib/attachments';
import { addNewExpenseItem, newExpenseItem } from './lib/items';
import { checkExpenseSupportsOCR, updateExpenseFormWithUploadResult } from './lib/ocr';
import { checkRequiresAddress, getSupportedCurrencies, validateExpenseTaxes } from './lib/utils';

import ConfirmationModal from '../ConfirmationModal';
import { Box, Flex } from '../Grid';
import { serializeAddress } from '../I18nAddressFields';
import PrivateInfoIcon from '../icons/PrivateInfoIcon';
import LoadingPlaceholder from '../LoadingPlaceholder';
import MessageBox from '../MessageBox';
import StyledButton from '../StyledButton';
import StyledCard from '../StyledCard';
import StyledHr from '../StyledHr';
import StyledInputFormikField from '../StyledInputFormikField';
import StyledInputTags from '../StyledInputTags';
import StyledTextarea from '../StyledTextarea';
import { Label, P, Span } from '../Text';
import { toast } from '../ui/useToast';

import ExpenseAttachedFilesForm from './ExpenseAttachedFilesForm';
import ExpenseCategorySelect from './ExpenseCategorySelect';
import ExpenseFormItems from './ExpenseFormItems';
import ExpenseFormPayeeInviteNewStep, { validateExpenseFormPayeeInviteNewStep } from './ExpenseFormPayeeInviteNewStep';
import ExpenseFormPayeeSignUpStep from './ExpenseFormPayeeSignUpStep';
import ExpenseFormPayeeStep from './ExpenseFormPayeeStep';
import { prepareExpenseItemForSubmit, validateExpenseItem } from './ExpenseItemForm';
import { ExpenseOCRPrefillStarter } from './ExpenseOCRPrefillStarter';
import ExpenseRecurringBanner from './ExpenseRecurringBanner';
import ExpenseSummaryAdditionalInformation from './ExpenseSummaryAdditionalInformation';
import ExpenseTypeRadioSelect from './ExpenseTypeRadioSelect';
import ExpenseTypeTag from './ExpenseTypeTag';
import { validatePayoutMethod } from './PayoutMethodForm';

export const msg = defineMessages({
  descriptionPlaceholder: {
    id: `ExpenseForm.DescriptionPlaceholder`,
    defaultMessage: 'Enter expense title here...',
  },
  grantSubjectPlaceholder: {
    id: `ExpenseForm.GrantSubjectPlaceholder`,
    defaultMessage: 'e.g., research, software development, etc...',
  },
  addNewReceipt: {
    id: 'ExpenseForm.AddReceipt',
    defaultMessage: 'Add new receipt',
  },
  addNewItem: {
    id: 'ExpenseForm.AddLineItem',
    defaultMessage: 'Add new item',
  },
  addNewGrantItem: {
    id: 'ExpenseForm.AddGrantItem',
    defaultMessage: 'Add grant item',
  },
  stepReceipt: {
    id: 'ExpenseForm.StepExpense',
    defaultMessage: 'Upload one or multiple receipt',
  },
  stepInvoice: {
    id: 'ExpenseForm.StepExpenseInvoice',
    defaultMessage: 'Set invoice details',
  },
  stepFundingRequest: {
    id: 'ExpenseForm.StepExpenseFundingRequest',
    defaultMessage: 'Set grant details',
  },
  stepPayee: {
    id: 'ExpenseForm.StepPayeeInvoice',
    defaultMessage: 'Payee information',
  },
  cancelEditExpense: {
    id: 'ExpenseForm.CancelEditExpense',
    defaultMessage: 'Cancel Edit',
  },
  confirmCancelEditExpense: {
    id: 'ExpenseForm.ConfirmCancelEditExpense',
    defaultMessage: 'Are you sure you want to cancel the edits?',
  },
  clearExpenseForm: {
    id: 'ExpenseForm.ClearExpenseForm',
    defaultMessage: 'Clear Form',
  },
  confirmClearExpenseForm: {
    id: 'ExpenseForm.ConfirmClearExpenseForm',
    defaultMessage: 'Are you sure you want to clear the expense form?',
  },
});

const getDefaultExpense = (collective, supportedExpenseTypes) => {
  const isSingleSupportedExpenseType = supportedExpenseTypes.length === 1;

  return {
    description: '',
    longDescription: '',
    items: [],
    attachedFiles: [],
    payee: null,
    payoutMethod: undefined,
    privateMessage: '',
    invoiceInfo: '',
    currency: collective.currency,
    taxes: null,
    type: isSingleSupportedExpenseType ? supportedExpenseTypes[0] : undefined,
    accountingCategory: undefined,
    payeeLocation: {
      address: '',
      country: null,
    },
  };
};

const CREATE_PAYEE_PROFILE_FIELDS = ['name', 'email', 'legalName', 'organization', 'newsletterOptIn'];

/**
 * Take the expense's data as generated by `ExpenseForm` and strips out all optional data
 * like URLs for items when the expense is an invoice.
 */
export const prepareExpenseForSubmit = expenseData => {
  const keepAttachedFiles = expenseTypeSupportsAttachments(expenseData.type);

  // Prepare payee
  let payee;
  if (expenseData.payee) {
    // Invites use a different format: the payee ID is passed as a number, not a uuid
    // See https://github.com/opencollective/opencollective-api/blob/88e9864a716e4a2ad5237a81cee177b781829f42/server/graphql/v2/input/ExpenseInviteDraftInput.ts#L29
    if (expenseData.payee.isInvite) {
      payee = pick(expenseData.payee, ['id', 'legacyId', ...CREATE_PAYEE_PROFILE_FIELDS]);
      // The collective picker still uses API V1 for when creating a new profile on the fly
      if (payee.legacyId) {
        payee.id = payee.legacyId;
        delete payee.legacyId;
      }
    } else if (expenseData.payee.isNewUser) {
      payee = pick(expenseData.payee, CREATE_PAYEE_PROFILE_FIELDS);
    } else {
      payee = getAccountReferenceInput(expenseData.payee);
    }
  }

  const payeeLocation = checkRequiresAddress(expenseData)
    ? pick(expenseData.payeeLocation, ['address', 'country', 'structured'])
    : null;

  const payoutMethod = pick(expenseData.payoutMethod, ['id', 'name', 'data', 'isSaved', 'type']);
  if (payoutMethod.id === 'new') {
    payoutMethod.id = null;
  }

  return {
    ...pick(expenseData, [
      'id',
      'description',
      'longDescription',
      'type',
      'privateMessage',
      'invoiceInfo',
      'tags',
      'currency',
    ]),
    payee,
    payeeLocation,
    payoutMethod,
    attachedFiles: keepAttachedFiles ? expenseData.attachedFiles?.map(file => pick(file, ['id', 'url', 'name'])) : [],
    tax: expenseData.taxes?.filter(tax => !tax.isDisabled).map(tax => pick(tax, ['type', 'rate', 'idNumber'])),
    items: expenseData.items.map(item => prepareExpenseItemForSubmit(expenseData, item)),
    accountingCategory: !expenseData.accountingCategory ? null : pick(expenseData.accountingCategory, ['id']),
  };
};

/**
 * Validate the expense
 */
const validateExpense = (intl, expense, collective, host, LoggedInUser) => {
  const isCardCharge = expense.type === expenseTypes.CHARGE;
  if (expense.payee?.isInvite) {
    return expense.payee.id
      ? requireFields(expense, ['description', 'payee', 'payee.id'])
      : requireFields(expense, ['description', 'payee', 'payee.name', 'payee.email']);
  }

  const errors = isCardCharge
    ? {}
    : expense.payee?.type === CollectiveType.VENDOR
      ? requireFields(expense, ['description', 'payee', 'currency'])
      : requireFields(expense, ['description', 'payee', 'payoutMethod', 'currency']);

  if (expense.items.length > 0) {
    const itemsErrors = expense.items.map(item => validateExpenseItem(expense, item));
    const hasErrors = itemsErrors.some(errors => !isEmpty(errors));
    if (hasErrors) {
      errors.items = itemsErrors;
    }
  }

  if (expense.taxes?.length) {
    const taxesErrors = validateExpenseTaxes(intl, expense.taxes);
    if (taxesErrors) {
      errors['taxes'] = taxesErrors;
    }
  }

  if (
    expense.payoutMethod &&
    // CHARGE expenses have VirtualCard and do not have PayoutMethod
    isCardCharge
  ) {
    const payoutMethodErrors = validatePayoutMethod(expense.payoutMethod);
    if (!isEmpty(payoutMethodErrors)) {
      errors.payoutMethod = payoutMethodErrors;
    }
  }

  if (checkRequiresAddress(expense)) {
    Object.assign(errors, requireFields(expense, ['payeeLocation.country', 'payeeLocation.address']));
  }

  if (userMustSetAccountingCategory(LoggedInUser, collective, host)) {
    Object.assign(errors, requireFields(expense, ['accountingCategory'], { allowNull: true }));
  }

  return errors;
};

const setLocationFromPayee = (formik, payee) => {
  formik.setFieldValue('payeeLocation.country', payee.location.country || null);
  formik.setFieldValue('payeeLocation.address', payee.location.address || '');
  formik.setFieldValue('payeeLocation.structured', payee.location.structured);
};

const HiddenFragment = styled.div`
  display: ${({ show }) => (show ? 'block' : 'none')};
`;

export const EXPENSE_FORM_STEPS = {
  PAYEE: 'PAYEE',
  EXPENSE: 'EXPENSE',
};

const checkAddressValuesAreCompleted = values => {
  if (checkRequiresAddress(values)) {
    return values.payeeLocation?.country && values.payeeLocation?.address;
  }
  return true;
};

const getDefaultStep = (defaultStep, stepOneCompleted, isCreditCardCharge) => {
  // Card Charges take priority here because they are technically incomplete.
  if (isCreditCardCharge) {
    return EXPENSE_FORM_STEPS.EXPENSE;
  } else if (!stepOneCompleted) {
    return EXPENSE_FORM_STEPS.PAYEE;
  } else {
    return defaultStep || EXPENSE_FORM_STEPS.PAYEE;
  }
};

const checkOCREnabled = (loggedInUser, router, host) => {
  const urlFlag = router.query.ocr && parseToBoolean(router.query.ocr);
  return (
    urlFlag !== false && isInternalHost(host) && (loggedInUser?.hasPreviewFeatureEnabled('EXPENSE_OCR') || urlFlag)
  );
};

const ExpenseFormBody = ({
  formik,
  payoutProfiles,
  collective,
  host,
  expense,
  autoFocusTitle,
  onCancel,
  formPersister,
  loggedInAccount,
  loading,
  expensesTags,
  shouldLoadValuesFromPersister,
  isDraft,
  defaultStep,
  drawerActionsContainer,
  supportedExpenseTypes,
}) => {
  const intl = useIntl();
  const { formatMessage } = intl;
  const router = useRouter();
  const formRef = React.useRef();
  const { LoggedInUser } = useLoggedInUser();
  const [hideOCRPrefillStater, setHideOCRPrefillStarter] = React.useState(false);
  const { values, handleChange, errors, setValues, dirty, touched, resetForm, setErrors } = formik;
  const hasBaseFormFieldsCompleted = values.type && values.description;
  const hasOCRPreviewEnabled = checkOCREnabled(LoggedInUser, router, host);
  const hasOCRFeature = hasOCRPreviewEnabled && checkExpenseSupportsOCR(values.type, LoggedInUser);
  const isInvite = values.payee?.isInvite;
  const isNewUser = !values.payee?.id;
  const isHostAdmin = Boolean(LoggedInUser?.isAdminOfCollective(host));
  const isReceipt = values.type === expenseTypes.RECEIPT;
  const isGrant = values.type === expenseTypes.GRANT;
  const isCreditCardCharge = values.type === expenseTypes.CHARGE;
  const isRecurring = expense && expense.recurringExpense !== null;
  const stepOneCompleted =
    values.payee?.type === CollectiveType.VENDOR ||
    (values.payoutMethod &&
      isEmpty(flattenObjectDeep(omit(errors, 'payoutMethod.data.currency'))) &&
      checkAddressValuesAreCompleted(values));
  const stepTwoCompleted = isInvite
    ? true
    : (stepOneCompleted || isCreditCardCharge) && hasBaseFormFieldsCompleted && values.items.length > 0;
  const availableCurrencies = getSupportedCurrencies(collective, values.payoutMethod);
  const [step, setStep] = React.useState(() => getDefaultStep(defaultStep, stepOneCompleted, isCreditCardCharge));
  const [initWithOCR, setInitWithOCR] = React.useState(null);

  // Only true when logged in and drafting the expense
  const [isOnBehalf, setOnBehalf] = React.useState(false);
  const [showResetModal, setShowResetModal] = React.useState(false);
  const editingExpense = expense !== undefined;

  // Scroll to top when step changes
  React.useEffect(() => {
    const boundingRect = formRef.current?.getBoundingClientRect();
    if (boundingRect) {
      const elemTop = boundingRect.top + window.scrollY;
      window.scroll({ top: elemTop - 75 });
    }
  }, [step]);

  // When user logs in we set its account as the default payout profile if not yet defined
  React.useEffect(() => {
    const payeePayoutProfile = values?.payee && payoutProfiles?.find(p => p.slug === values.payee.slug);
    if (values?.draft?.payee && !loggedInAccount && !isRecurring) {
      formik.setFieldValue('payee', {
        ...values.draft.payee,
        isInvite: false,
        isNewUser: true,
      });
    }
    // If logged in user edits a DRAFT without a key and it's not the payee, we'll presume they only want to edit the draft and not submit the draft
    else if (
      !payeePayoutProfile &&
      loggedInAccount &&
      isDraft &&
      values?.payee.type !== CollectiveType.VENDOR &&
      !router.query?.key &&
      !isRecurring
    ) {
      setOnBehalf(true);
    }
    // If creating a new expense or completing an expense submitted on your behalf, automatically select your default profile.
    else if (!isOnBehalf && (isDraft || !values.payee) && loggedInAccount && !isEmpty(payoutProfiles)) {
      const defaultProfile = payeePayoutProfile || first(payoutProfiles);
      formik.setFieldValue('payee', defaultProfile);
    }
    // Update the form state with private fields that were refeched after the user was authenticated
    if (isDraft && loggedInAccount) {
      const privateFields = ['payoutMethod', 'invoiceInfo'];
      for (const field of privateFields) {
        if (!values[field] && expense[field]) {
          formik.setFieldValue(field, expense[field]);
        }
      }
    }
  }, [payoutProfiles, loggedInAccount]);

  // Pre-fill with OCR data when the expense type is set
  React.useEffect(() => {
    if (initWithOCR && values.type) {
      updateExpenseFormWithUploadResult(collective, formik, initWithOCR);
      setInitWithOCR(null);
    }
  }, [initWithOCR, values.type]);

  // Pre-fill address based on the payout profile
  React.useEffect(() => {
    if (!values.payeeLocation?.address && values.payee?.location) {
      setLocationFromPayee(formik, values.payee);
    }
  }, [values.payee]);

  // Return to Payee step if type is changed and reset some values
  const previousType = usePrevious(values.type);
  React.useEffect(() => {
    if (!isCreditCardCharge && previousType && values.type !== previousType) {
      setStep(EXPENSE_FORM_STEPS.PAYEE);
      setOnBehalf(false);

      if (!isDraft && values.payee?.isInvite) {
        formik.setFieldValue('payee', null);
      }

      // Only invoices can have taxes
      if (values.taxes?.length && !values.taxes[0].isDisabled && values.type !== expenseTypes.INVOICE) {
        formik.setFieldValue('taxes', [{ ...values.taxes[0], isDisabled: true }]);
      }
    }
  }, [values.type]);

  React.useEffect(() => {
    if (values.payeeLocation?.structured) {
      formik.setFieldValue('payeeLocation.address', serializeAddress(values.payeeLocation.structured));
    }
  }, [values.payeeLocation]);

  React.useEffect(() => {
    // If the currency is not supported anymore, we need to do something
    if (!loading && (!values.currency || !availableCurrencies.includes(values.currency))) {
      const hasItemsWithAmounts = values.items.some(item => Boolean(item.amount));
      if (!hasItemsWithAmounts) {
        // If no items have amounts yet, we can safely set the default currency
        formik.setFieldValue('currency', availableCurrencies[0]);
      } else if (values.currency) {
        // If there are items with amounts, we need to reset the currency
        formik.setFieldValue('currency', null);
      }
    }
  }, [loading, values.payoutMethod]);

  // Load values from localstorage
  React.useEffect(() => {
    if (shouldLoadValuesFromPersister && formPersister && !dirty && !isDraft) {
      const formValues = formPersister.loadValues();
      if (formValues) {
        // Reset payoutMethod if host is no longer connected to TransferWise
        if (formValues.payoutMethod?.type === PayoutMethodType.BANK_ACCOUNT && !host?.transferwise) {
          formValues.payoutMethod = undefined;
        }
        setValues(
          omit(
            formValues,
            // Omit deprecated fields, otherwise it will prevent expense submission
            ['location', 'privateInfo'],
          ),
        );
      }
    }
  }, [formPersister, dirty]);

  // Save values in localstorage
  React.useEffect(() => {
    if (dirty && formPersister) {
      formPersister.saveValues(values);
    }
  }, [formPersister, dirty, values]);

  let payeeForm;
  if (loading) {
    payeeForm = <LoadingPlaceholder height={32} />;
  } else if (isDraft && !loggedInAccount) {
    payeeForm = (
      <ExpenseFormPayeeSignUpStep
        collective={collective}
        formik={formik}
        onCancel={onCancel}
        onNext={() => setStep(EXPENSE_FORM_STEPS.EXPENSE)}
      />
    );
  } else if (isOnBehalf === true && isNewUser) {
    payeeForm = (
      <ExpenseFormPayeeInviteNewStep
        collective={collective}
        formik={formik}
        onBack={() => {
          setStep(EXPENSE_FORM_STEPS.PAYEE);
          setOnBehalf(false);
          formik.setFieldValue('payee', null);
          formik.setFieldValue('payoutMethod', null);
          formik.setFieldValue('payeeLocation', null);
        }}
        onNext={() => {
          formik.setFieldValue('payee', { ...values.payee, isInvite: true });
          const errors = validateExpenseFormPayeeInviteNewStep(formik.values);
          if (!isEmpty(errors)) {
            formik.setErrors(errors);
          } else {
            setStep(EXPENSE_FORM_STEPS.EXPENSE);
          }
        }}
        payoutProfiles={payoutProfiles}
      />
    );
  } else {
    payeeForm = (
      <ExpenseFormPayeeStep
        collective={collective}
        formik={formik}
        isOnBehalf={isOnBehalf}
        onCancel={onCancel}
        handleClearPayeeStep={() => setShowResetModal(true)}
        payoutProfiles={payoutProfiles}
        loggedInAccount={loggedInAccount}
        disablePayee={isDraft && isOnBehalf}
        onChange={payee => {
          setOnBehalf(payee.isInvite);
        }}
        onNext={values => {
          const shouldSkipPayoutMethodValidation =
            (isOnBehalf || values.payee?.type === CollectiveType.VENDOR) && isEmpty(values.payoutMethod);
          const validation = !shouldSkipPayoutMethodValidation && validatePayoutMethod(values.payoutMethod);
          if (isEmpty(validation)) {
            setStep(EXPENSE_FORM_STEPS.EXPENSE);
          } else {
            setErrors({ payoutMethod: validation });
          }
        }}
        editingExpense={editingExpense}
        resetDefaultStep={() => setStep(EXPENSE_FORM_STEPS.PAYEE)}
        formPersister={formPersister}
        onInvite={isInvite => {
          setOnBehalf(isInvite);
          formik.setFieldValue('payeeLocation', {});
          formik.setFieldValue('payee', {});
          formik.setFieldValue('payoutMethod', {});
        }}
        drawerActionsContainer={drawerActionsContainer}
      />
    );
  }

  const actionButtons = (
    <Flex flex={1} gridGap={[2, 3]} flexWrap="wrap">
      <StyledButton
        type="button"
        width={['100%', 'auto']}
        whiteSpace="nowrap"
        data-cy="expense-back"
        onClick={() => {
          if (isCreditCardCharge) {
            onCancel();
          } else {
            setStep(EXPENSE_FORM_STEPS.PAYEE);
          }
        }}
      >
        ←&nbsp;
        <FormattedMessage id="Back" defaultMessage="Back" />
      </StyledButton>
      <StyledButton
        type="submit"
        width={['100%', 'auto']}
        whiteSpace="nowrap"
        data-cy="expense-summary-btn"
        buttonStyle="primary"
        disabled={!stepTwoCompleted || !formik.isValid}
        loading={formik.isSubmitting}
        onClick={() => {
          // When used inside the drawer, the submit button is rendered outside the form (with a portal). The form must be manually submitted.
          if (drawerActionsContainer && formRef.current) {
            formRef.current.requestSubmit();
          }
        }}
      >
        {isInvite && !isDraft ? (
          <FormattedMessage id="Expense.SendInvite" defaultMessage="Send Invite" />
        ) : isCreditCardCharge ? (
          <FormattedMessage id="Expense.SaveReceipt" defaultMessage="Save Receipt" />
        ) : (
          <FormattedMessage id="Pagination.Next" defaultMessage="Next" />
        )}
        &nbsp;→
      </StyledButton>
      {errors.payoutMethod?.data?.currency && touched.items?.some?.(i => i.amount) && (
        <Box mx={[2, 0]} mt={2} color="red.500" fontSize="12px" letterSpacing={0}>
          {errors.payoutMethod.data.currency.toString()}
        </Box>
      )}

      <StyledButton
        type="button"
        buttonStyle="borderless"
        width={['100%', 'auto']}
        color="red.500"
        marginLeft="auto"
        whiteSpace="nowrap"
        onClick={() => setShowResetModal(true)}
      >
        <Undo size={11} />
        <Span mx={1}>{formatMessage(editingExpense ? msg.cancelEditExpense : msg.clearExpenseForm)}</Span>
      </StyledButton>
    </Flex>
  );

  return (
    <Form ref={formRef}>
      {!isCreditCardCharge && (
        <ExpenseTypeRadioSelect
          name="type"
          onChange={handleChange}
          value={values.type}
          supportedExpenseTypes={supportedExpenseTypes}
        />
      )}
      {Boolean(!values.type && !hideOCRPrefillStater && hasOCRPreviewEnabled && LoggedInUser?.isRoot) && (
        <ExpenseOCRPrefillStarter
          onUpload={() => setHideOCRPrefillStarter(true)}
          onSuccess={uploadResult => {
            // We want to make sure that the expense type is set before prefilling the form
            if (values.type) {
              updateExpenseFormWithUploadResult(collective, formik, uploadResult);
            } else {
              setInitWithOCR(uploadResult);
            }

            toast({
              variant: 'success',
              message: (
                <FormattedMessage defaultMessage="The expense has been automatically prefilled with the information from the document" />
              ),
            });
          }}
        />
      )}
      {isRecurring && <ExpenseRecurringBanner expense={expense} />}
      {values.type && (
        <StyledCard mt={4} p={[16, 16, 32]} overflow="initial">
          {step === EXPENSE_FORM_STEPS.PAYEE ? (
            <div>
              <Flex alignItems="center" mb={16}>
                <Span color="black.900" fontSize="18px" lineHeight="26px" fontWeight="bold">
                  {formatMessage(msg.stepPayee)}
                </Span>
                <Box ml={2}>
                  <PrivateInfoIcon size={12} color="#969BA3" tooltipProps={{ display: 'flex' }} />
                </Box>
                <StyledHr flex="1" borderColor="black.300" mx={2} />
              </Flex>
              {payeeForm}
            </div>
          ) : step === EXPENSE_FORM_STEPS.EXPENSE ? (
            <div>
              <Flex alignItems="center" mb={10}>
                <P
                  as="label"
                  htmlFor="expense-description"
                  color="black.900"
                  fontSize="18px"
                  lineHeight="26px"
                  fontWeight="bold"
                >
                  {values.type === expenseTypes.GRANT ? (
                    <FormattedMessage
                      id="Expense.EnterRequestSubject"
                      defaultMessage="Enter grant subject <small>(Public)</small>"
                      values={{
                        small(msg) {
                          return (
                            <Span fontSize="14px" fontWeight="normal" color="black.600" fontStyle="italic">
                              {msg}
                            </Span>
                          );
                        },
                      }}
                    />
                  ) : (
                    <FormattedMessage
                      id="Expense.EnterExpenseTitle"
                      defaultMessage="Expense title <small>(Public)</small>"
                      values={{
                        small(msg) {
                          return (
                            <Span fontSize="14px" fontWeight="normal" color="black.600" fontStyle="italic">
                              {msg}
                            </Span>
                          );
                        },
                      }}
                    />
                  )}
                </P>
                <StyledHr flex="1" borderColor="black.300" ml={2} />
              </Flex>
              <P fontSize="12px" color="black.600">
                <FormattedMessage
                  id="Expense.PrivacyWarning"
                  defaultMessage="This information is public. Do not put any private details in this field."
                />
              </P>
              <Field
                as={StyledTextarea}
                autoFocus={autoFocusTitle}
                error={errors.description}
                fontSize="24px"
                id="expense-description"
                maxLength={255}
                mt={3}
                name="description"
                px="12px"
                py="8px"
                width="100%"
                autoSize
                placeholder={
                  values.type === expenseTypes.GRANT
                    ? formatMessage(msg.grantSubjectPlaceholder)
                    : formatMessage(msg.descriptionPlaceholder)
                }
              />
              <HiddenFragment show={hasBaseFormFieldsCompleted || isInvite}>
                <Flex alignItems="flex-start" mt="8px">
                  <ExpenseTypeTag type={values.type} mr="4px" />
                  <StyledInputTags
                    suggestedTags={expensesTags}
                    onChange={tags => {
                      formik.setFieldValue(
                        'tags',
                        tags.map(t => t.value.toLowerCase()),
                      );
                    }}
                    value={values.tags}
                  />
                </Flex>
                {userMustSetAccountingCategory(LoggedInUser, collective, host) && (
                  <div className="mt-10">
                    <Label
                      htmlFor="ExpenseCategoryInput"
                      color="black.900"
                      fontSize="18px"
                      lineHeight="26px"
                      fontWeight="bold"
                    >
                      <FormattedMessage defaultMessage="Set Expense Category" />
                    </Label>
                    <div className="mt-2 flex">
                      <div className="basis-[300px]">
                        <StyledInputFormikField name="accountingCategory" lab>
                          {({ meta }) => (
                            <div>
                              <ExpenseCategorySelect
                                id="ExpenseCategoryInput"
                                host={host}
                                selectedCategory={values.accountingCategory}
                                onChange={value => formik.setFieldValue('accountingCategory', value)}
                                error={Boolean(meta.error)}
                                allowNone={!isHostAdmin}
                                showCode={isHostAdmin}
                              />
                              {meta.error && meta.touched && (
                                <Span color="red.500" fontSize="12px" mt="4px">
                                  {formatErrorMessage(intl, meta.error)}
                                </Span>
                              )}
                            </div>
                          )}
                        </StyledInputFormikField>
                      </div>
                    </div>
                    <MessageBox type="info" fontSize="12px" mt="24px">
                      <FormattedMessage defaultMessage="Please make sure that all the expense items in this expense belong to the selected expense category. If needed, you may submit additional items in separate expenses with different expense categories." />
                    </MessageBox>
                  </div>
                )}
                {values.type === expenseTypes.INVOICE && (
                  <Box my={40}>
                    <ExpenseAttachedFilesForm
                      collective={collective}
                      title={<FormattedMessage id="UploadInvoice" defaultMessage="Upload invoice" />}
                      description={
                        <FormattedMessage
                          id="UploadInvoiceDescription"
                          defaultMessage="If you already have an invoice document, you can upload it here."
                        />
                      }
                      form={formik}
                      defaultValue={values.attachedFiles}
                      hasOCRFeature={hasOCRFeature}
                    />
                  </Box>
                )}

                <Flex alignItems="center" my={24}>
                  <Span color="black.900" fontSize="18px" lineHeight="26px" fontWeight="bold">
                    {formatMessage(isReceipt ? msg.stepReceipt : isGrant ? msg.stepFundingRequest : msg.stepInvoice)}
                  </Span>
                  <StyledHr flex="1" borderColor="black.300" mx={2} />
                  <StyledButton
                    buttonSize="tiny"
                    type="button"
                    onClick={() => addNewExpenseItem(formik)}
                    minWidth={135}
                    data-cy="expense-add-item-btn"
                    disabled={isCreditCardCharge}
                  >
                    +&nbsp;
                    {formatMessage(isReceipt ? msg.addNewReceipt : isGrant ? msg.addNewGrantItem : msg.addNewItem)}
                  </StyledButton>
                </Flex>
                <Box>
                  <FieldArray name="items">
                    {fieldsArrayProps => (
                      <ExpenseFormItems
                        {...fieldsArrayProps}
                        collective={collective}
                        availableCurrencies={availableCurrencies}
                        hasOCRFeature={hasOCRFeature}
                      />
                    )}
                  </FieldArray>
                </Box>

                {values.type === expenseTypes.GRANT && (
                  <Box my={40}>
                    <ExpenseAttachedFilesForm
                      collective={collective}
                      title={<FormattedMessage id="UploadDocumentation" defaultMessage="Upload documentation" />}
                      description={
                        <FormattedMessage
                          id="UploadDocumentationDescription"
                          defaultMessage="If you want to include any documentation, you can upload it here."
                        />
                      }
                      form={formik}
                      defaultValue={values.attachedFiles}
                      hasOCRFeature={hasOCRFeature}
                    />
                  </Box>
                )}

                {drawerActionsContainer ? (
                  createPortal(actionButtons, drawerActionsContainer)
                ) : (
                  <Fragment>
                    <StyledHr flex="1" mt={4} mb={3} borderColor="black.300" />
                    {actionButtons}
                  </Fragment>
                )}
              </HiddenFragment>
            </div>
          ) : null}
        </StyledCard>
      )}
      {step === EXPENSE_FORM_STEPS.EXPENSE && (
        <StyledCard mt={4} p={[16, 24, 32]} overflow="initial">
          <ExpenseSummaryAdditionalInformation expense={formik.values} host={host} collective={collective} />
        </StyledCard>
      )}
      {showResetModal && (
        <ConfirmationModal
          onClose={() => setShowResetModal(false)}
          header={editingExpense ? formatMessage(msg.cancelEditExpense) : formatMessage(msg.clearExpenseForm)}
          body={
            editingExpense ? formatMessage(msg.confirmCancelEditExpense) : formatMessage(msg.confirmClearExpenseForm)
          }
          continueHandler={() => {
            if (editingExpense) {
              onCancel();
            } else {
              setStep(EXPENSE_FORM_STEPS.PAYEE);
              resetForm({ values: getDefaultExpense(collective, supportedExpenseTypes) });
              setHideOCRPrefillStarter(false);
              if (formPersister) {
                formPersister.clearValues();
                window.scrollTo(0, 0);
              }
            }
            setShowResetModal(false);
          }}
          {...(editingExpense && {
            continueLabel: formatMessage({ defaultMessage: 'Yes, cancel editing' }),
            cancelLabel: formatMessage({ defaultMessage: 'No, continue editing' }),
          })}
        />
      )}
    </Form>
  );
};

ExpenseFormBody.propTypes = {
  formik: PropTypes.object,
  payoutProfiles: PropTypes.array,
  autoFocusTitle: PropTypes.bool,
  shouldLoadValuesFromPersister: PropTypes.bool,
  onCancel: PropTypes.func,
  formPersister: PropTypes.object,
  /** Defines the default selected step, if accessible (previous steps need to be completed) */
  defaultStep: PropTypes.oneOf(Object.values(EXPENSE_FORM_STEPS)),
  loggedInAccount: PropTypes.object,
  loading: PropTypes.bool,
  isDraft: PropTypes.bool,
  expensesTags: PropTypes.arrayOf(PropTypes.string),
  host: PropTypes.shape({
    transferwise: PropTypes.shape({
      availableCurrencies: PropTypes.arrayOf(PropTypes.object),
    }),
    settings: PropTypes.shape({
      expenseTypes: PropTypes.shape({
        GRANT: PropTypes.bool,
        RECEIPT: PropTypes.bool,
        INVOICE: PropTypes.bool,
      }),
    }),
  }),
  collective: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    currency: PropTypes.string.isRequired,
    settings: PropTypes.object,
    isApproved: PropTypes.bool,
  }).isRequired,
  expense: PropTypes.shape({
    type: PropTypes.oneOf(Object.values(expenseTypes)),
    currency: PropTypes.string,
    description: PropTypes.string,
    status: PropTypes.string,
    payee: PropTypes.object,
    draft: PropTypes.object,
    payoutMethod: PropTypes.object,
    recurringExpense: PropTypes.shape({
      interval: PropTypes.string,
      endsAt: PropTypes.string,
    }),
    amountInAccountCurrency: AmountPropTypeShape,
    items: PropTypes.arrayOf(
      PropTypes.shape({
        url: PropTypes.string,
      }),
    ),
  }),
  drawerActionsContainer: PropTypes.object,
  supportedExpenseTypes: PropTypes.arrayOf(PropTypes.string),
};

/**
 * Main create expense form
 */
const ExpenseForm = ({
  onSubmit,
  collective,
  host,
  expense,
  originalExpense,
  payoutProfiles,
  autoFocusTitle,
  onCancel,
  validateOnChange,
  formPersister,
  loggedInAccount,
  loading,
  expensesTags,
  shouldLoadValuesFromPersister,
  defaultStep,
  drawerActionsContainer,
}) => {
  const isDraft = expense?.status === ExpenseStatus.DRAFT;
  const [hasValidate, setValidate] = React.useState(validateOnChange && !isDraft);
  const intl = useIntl();
  const { LoggedInUser } = useLoggedInUser();
  const supportedExpenseTypes = React.useMemo(() => getSupportedExpenseTypes(collective), [collective]);
  const initialValues = { ...getDefaultExpense(collective, supportedExpenseTypes), ...expense };
  const validate = expenseData => validateExpense(intl, expenseData, collective, host, LoggedInUser);
  if (isDraft) {
    initialValues.items = expense.draft.items?.map(newExpenseItem) || [];
    initialValues.taxes = expense.draft.taxes;
    initialValues.attachedFiles = expense.draft.attachedFiles;
    initialValues.payoutMethod = expense.draft.payoutMethod;
    initialValues.payeeLocation = expense.draft.payeeLocation;
    initialValues.payee = expense.recurringExpense ? expense.payee : expense.draft.payee;
  }

  return (
    <Formik
      initialValues={initialValues}
      validate={hasValidate && validate}
      onSubmit={async (values, formik) => {
        // We initially let the browser do the validation. Then once users try to submit the
        // form at least once, we validate on each change to make sure they fix all the errors.
        const errors = validate(values);
        if (!isEmpty(errors)) {
          setValidate(true);
          formik.setErrors(errors);
        } else {
          return onSubmit(values);
        }
      }}
    >
      {formik => (
        <ExpenseFormBody
          formik={formik}
          payoutProfiles={payoutProfiles}
          collective={collective}
          host={host}
          expense={originalExpense}
          autoFocusTitle={autoFocusTitle}
          onCancel={onCancel}
          formPersister={formPersister}
          loggedInAccount={loggedInAccount}
          expensesTags={expensesTags}
          loading={loading}
          shouldLoadValuesFromPersister={shouldLoadValuesFromPersister}
          isDraft={isDraft}
          defaultStep={defaultStep}
          drawerActionsContainer={drawerActionsContainer}
          supportedExpenseTypes={supportedExpenseTypes}
        />
      )}
    </Formik>
  );
};

ExpenseForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  autoFocusTitle: PropTypes.bool,
  validateOnChange: PropTypes.bool,
  shouldLoadValuesFromPersister: PropTypes.bool,
  onCancel: PropTypes.func,
  /** To save draft of form values */
  formPersister: PropTypes.object,
  loggedInAccount: PropTypes.object,
  loading: PropTypes.bool,
  expensesTags: PropTypes.arrayOf(PropTypes.string),
  /** Defines the default selected step, if accessible (previous steps need to be completed) */
  defaultStep: PropTypes.oneOf(Object.values(EXPENSE_FORM_STEPS)),
  host: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    transferwise: PropTypes.shape({
      availableCurrencies: PropTypes.arrayOf(PropTypes.object),
    }),
  }),
  collective: PropTypes.shape({
    currency: PropTypes.string.isRequired,
    slug: PropTypes.string.isRequired,
    settings: PropTypes.object,
    isApproved: PropTypes.bool,
  }).isRequired,
  /** If editing */
  expense: PropTypes.shape({
    type: PropTypes.oneOf(Object.values(expenseTypes)),
    description: PropTypes.string,
    status: PropTypes.string,
    payee: PropTypes.object,
    draft: PropTypes.object,
    recurringExpense: PropTypes.object,
    items: PropTypes.arrayOf(
      PropTypes.shape({
        url: PropTypes.string,
      }),
    ),
  }),
  /** To reset form */
  originalExpense: PropTypes.shape({
    type: PropTypes.oneOf(Object.values(expenseTypes)),
    description: PropTypes.string,
    status: PropTypes.string,
    payee: PropTypes.object,
    draft: PropTypes.object,
    payoutMethod: PropTypes.object,
    items: PropTypes.arrayOf(
      PropTypes.shape({
        url: PropTypes.string,
      }),
    ),
  }),
  /** Payout profiles that user has access to */
  payoutProfiles: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      slug: PropTypes.string,
      location: PropTypes.shape({
        address: PropTypes.string,
        country: PropTypes.string,
        structured: PropTypes.object,
      }),
      payoutMethods: PropTypes.arrayOf(
        PropTypes.shape({
          id: PropTypes.string,
          type: PropTypes.oneOf(Object.values(PayoutMethodType)),
          name: PropTypes.string,
          data: PropTypes.object,
        }),
      ),
    }),
  ),
  drawerActionsContainer: PropTypes.object,
};

ExpenseForm.defaultProps = {
  validateOnChange: false,
};

export default React.memo(ExpenseForm);
