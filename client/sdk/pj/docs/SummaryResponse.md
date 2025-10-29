# SummaryResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**clientId** | **string** |  | [default to undefined]
**bankAccountId** | **string** |  | [default to undefined]
**from** | **string** | Start of the effective analysis window in DD/MM/YYYY format | [optional] [default to undefined]
**to** | **string** | End of the effective analysis window in DD/MM/YYYY format | [optional] [default to undefined]
**totals** | [**SummaryResponseTotals**](SummaryResponseTotals.md) |  | [default to undefined]
**kpis** | [**SummaryResponseKpis**](SummaryResponseKpis.md) |  | [default to undefined]
**series** | [**SummaryResponseSeries**](SummaryResponseSeries.md) |  | [default to undefined]
**metadata** | [**SummaryResponseMetadata**](SummaryResponseMetadata.md) |  | [default to undefined]

## Example

```typescript
import { SummaryResponse } from './api';

const instance: SummaryResponse = {
    clientId,
    bankAccountId,
    from,
    to,
    totals,
    kpis,
    series,
    metadata,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
