# BankTransaction


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**bankTxId** | **string** | Unique identifier assigned to the transaction inside Finance CoPilot | [default to undefined]
**date** | **string** | Transaction posting date in DD/MM/YYYY format | [default to undefined]
**desc** | **string** | Raw description obtained from the bank statement | [default to undefined]
**amount** | **number** | Positive values are inflows, negative values are outflows | [default to undefined]
**bankAccountId** | **string** | Identifier of the bank account that owns the transaction | [default to undefined]
**accountId** | **string** | Identifier provided by the originating bank, when available | [optional] [default to undefined]
**fitid** | **string** | Unique identifier provided by the OFX file | [optional] [default to undefined]
**sourceHash** | **string** | SHA256 hash of the imported OFX file used for deduplication | [optional] [default to undefined]
**linkedLegs** | [**Array&lt;BankTransactionLinkedLegsInner&gt;**](BankTransactionLinkedLegsInner.md) | Sale legs that were reconciled against this transaction | [default to undefined]
**reconciled** | **boolean** | Indicates whether the transaction is reconciled with a sale | [default to undefined]
**categorizedAs** | [**BankTransactionCategorizedAs**](BankTransactionCategorizedAs.md) |  | [optional] [default to undefined]
**dfcCategory** | **string** | Legacy DFC category associated with the transaction | [optional] [default to undefined]
**dfcItem** | **string** | Legacy DFC item associated with the transaction | [optional] [default to undefined]
**categorizedBy** | **string** | Categorization source (manual, rule, auto) | [optional] [default to undefined]
**categorizedRuleId** | **string** | Identifier of the rule used for categorization when applicable | [optional] [default to undefined]

## Example

```typescript
import { BankTransaction } from './api';

const instance: BankTransaction = {
    bankTxId,
    date,
    desc,
    amount,
    bankAccountId,
    accountId,
    fitid,
    sourceHash,
    linkedLegs,
    reconciled,
    categorizedAs,
    dfcCategory,
    dfcItem,
    categorizedBy,
    categorizedRuleId,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
