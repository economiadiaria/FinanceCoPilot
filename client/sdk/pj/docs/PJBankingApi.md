# PJBankingApi

All URIs are relative to *https://api.financecopilot.local*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**apiPjAccountsGet**](#apipjaccountsget) | **GET** /api/pj/accounts | List bank accounts available for the authenticated PJ client|
|[**apiPjSummaryGet**](#apipjsummaryget) | **GET** /api/pj/summary | Retrieve aggregated cash-flow summary for a PJ client account|
|[**apiPjTransactionsGet**](#apipjtransactionsget) | **GET** /api/pj/transactions | List paginated bank transactions for a PJ client account|

# **apiPjAccountsGet**
> AccountsResponse apiPjAccountsGet()

Returns the bank accounts that are available to the authenticated PJ client. Only a subset of bank account fields is exposed to avoid leaking sensitive identifiers. 

### Example

```typescript
import {
    PJBankingApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new PJBankingApi(configuration);

const { status, data } = await apiInstance.apiPjAccountsGet();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**AccountsResponse**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Bank accounts successfully retrieved |  -  |
|**401** | Authentication is required |  -  |
|**500** | Unexpected error while retrieving accounts |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiPjSummaryGet**
> SummaryResponse apiPjSummaryGet()

Calculates aggregated totals, KPIs and daily net flow series for a PJ bank account inside the requested date range. When the date range is omitted the backend automatically expands it to the available transaction history. 

### Example

```typescript
import {
    PJBankingApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new PJBankingApi(configuration);

let clientId: string; //Unique identifier for the PJ client (default to undefined)
let bankAccountId: string; //Unique identifier for the bank account that must be accessible by the authenticated user (default to undefined)
let from: string; //Start of the reporting window in DD/MM/YYYY format (optional) (default to undefined)
let to: string; //End of the reporting window in DD/MM/YYYY format (optional) (default to undefined)

const { status, data } = await apiInstance.apiPjSummaryGet(
    clientId,
    bankAccountId,
    from,
    to
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **clientId** | [**string**] | Unique identifier for the PJ client | defaults to undefined|
| **bankAccountId** | [**string**] | Unique identifier for the bank account that must be accessible by the authenticated user | defaults to undefined|
| **from** | [**string**] | Start of the reporting window in DD/MM/YYYY format | (optional) defaults to undefined|
| **to** | [**string**] | End of the reporting window in DD/MM/YYYY format | (optional) defaults to undefined|


### Return type

**SummaryResponse**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Summary successfully generated |  * ETag - Strong ETag associated with the response payload <br>  |
|**304** | Resource not modified since the provided ETag |  -  |
|**400** | Invalid request parameters |  -  |
|**401** | Authentication is required |  -  |
|**403** | Authenticated user does not have access to the bank account |  -  |
|**404** | Requested bank account was not found |  -  |
|**500** | Unexpected error while generating the summary |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **apiPjTransactionsGet**
> BankTransactionListResponse apiPjTransactionsGet()

Returns the paginated bank transactions imported for a specific PJ bank account. Transactions are filtered by the optional period and sorted by posting date. 

### Example

```typescript
import {
    PJBankingApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new PJBankingApi(configuration);

let clientId: string; //Unique identifier for the PJ client (default to undefined)
let bankAccountId: string; //Unique identifier for the bank account that must be accessible by the authenticated user (default to undefined)
let from: string; //Start of the reporting window in DD/MM/YYYY format (optional) (default to undefined)
let to: string; //End of the reporting window in DD/MM/YYYY format (optional) (default to undefined)
let page: number; //Results page to return (defaults to 1) (optional) (default to undefined)
let limit: number; //Number of items per page (defaults to 50, capped at 200) (optional) (default to undefined)
let sort: 'asc' | 'desc'; //Sort direction for the transaction date (optional) (default to 'desc')

const { status, data } = await apiInstance.apiPjTransactionsGet(
    clientId,
    bankAccountId,
    from,
    to,
    page,
    limit,
    sort
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **clientId** | [**string**] | Unique identifier for the PJ client | defaults to undefined|
| **bankAccountId** | [**string**] | Unique identifier for the bank account that must be accessible by the authenticated user | defaults to undefined|
| **from** | [**string**] | Start of the reporting window in DD/MM/YYYY format | (optional) defaults to undefined|
| **to** | [**string**] | End of the reporting window in DD/MM/YYYY format | (optional) defaults to undefined|
| **page** | [**number**] | Results page to return (defaults to 1) | (optional) defaults to undefined|
| **limit** | [**number**] | Number of items per page (defaults to 50, capped at 200) | (optional) defaults to undefined|
| **sort** | [**&#39;asc&#39; | &#39;desc&#39;**]**Array<&#39;asc&#39; &#124; &#39;desc&#39;>** | Sort direction for the transaction date | (optional) defaults to 'desc'|


### Return type

**BankTransactionListResponse**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Bank transactions successfully retrieved |  * ETag - Strong ETag associated with the response payload <br>  |
|**304** | Resource not modified since the provided ETag |  -  |
|**400** | Invalid request parameters |  -  |
|**401** | Authentication is required |  -  |
|**403** | Authenticated user does not have access to the bank account |  -  |
|**404** | Requested bank account was not found |  -  |
|**500** | Unexpected error while retrieving transactions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

