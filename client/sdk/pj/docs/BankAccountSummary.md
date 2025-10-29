# BankAccountSummary


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** | Bank account identifier | [default to undefined]
**bankName** | **string** | Display name of the bank | [default to undefined]
**accountNumberMask** | **string** | Masked bank account number where only the last digits are visible | [default to undefined]
**accountType** | **string** | Type of the bank account (e.g. corrente, poupanca) | [default to undefined]
**currency** | **string** | ISO currency code (e.g. BRL) | [default to undefined]
**isActive** | **boolean** | Indicates whether the account is active and available for ingestion | [default to undefined]

## Example

```typescript
import { BankAccountSummary } from './api';

const instance: BankAccountSummary = {
    id,
    bankName,
    accountNumberMask,
    accountType,
    currency,
    isActive,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
