import {
  getPJBankingAPI,
  type DeleteApiPjClientIdCategoriesCategoryIdResult,
  type DeleteApiPjGlobalCategoriesCategoryIdResult,
  type GetApiPjClientIdCategoriesResult,
  type GetApiPjGlobalCategoriesResult,
  type PatchApiPjClientIdCategoriesCategoryIdResult,
  type PatchApiPjGlobalCategoriesCategoryIdResult,
  type PostApiPjClientIdCategoriesResult,
  type PostApiPjGlobalCategoriesResult,
} from "./pjBanking.gen";

export * from "../pj";
export {
  type GetApiPjClientIdCategoriesParams,
  type GetApiPjGlobalCategoriesParams,
  type PatchApiPjClientIdCategoriesCategoryId200,
  type PatchApiPjGlobalCategoriesCategoryId200,
  type PjCategoryTreeNode,
  type PjCategoryTreeNodeType,
  type PjCategoryTreeResponse,
  type PjCategoryTreeResponseType,
  type PjClientCategoryCreate,
  type PjClientCategoryNode,
  type PjClientCategoryNodeAllOf,
  type PjClientCategoryNodeAllOfType,
  type PjClientCategoryUpdate,
  type PjGlobalCategoryCreate,
  type PjGlobalCategoryNode,
  type PjGlobalCategoryNodeAllOf,
  type PjGlobalCategoryNodeAllOfType,
  type PjGlobalCategoryUpdate,
  type PostApiPjClientIdCategories201,
  type PostApiPjGlobalCategories201,
  type TreeQueryParameter,
} from "./model";
export { getPJBankingAPI };

const {
  getApiPjGlobalCategories,
  postApiPjGlobalCategories,
  patchApiPjGlobalCategoriesCategoryId,
  deleteApiPjGlobalCategoriesCategoryId,
  getApiPjClientIdCategories,
  postApiPjClientIdCategories,
  patchApiPjClientIdCategoriesCategoryId,
  deleteApiPjClientIdCategoriesCategoryId,
} = getPJBankingAPI();

export const listPjGlobalCategories = getApiPjGlobalCategories;
export const createPjGlobalCategory = postApiPjGlobalCategories;
export const updatePjGlobalCategory = patchApiPjGlobalCategoriesCategoryId;
export const deletePjGlobalCategory = deleteApiPjGlobalCategoriesCategoryId;

export const listPjClientCategories = getApiPjClientIdCategories;
export const createPjClientCategory = postApiPjClientIdCategories;
export const updatePjClientCategory = patchApiPjClientIdCategoriesCategoryId;
export const deletePjClientCategory = deleteApiPjClientIdCategoriesCategoryId;

export type ListPjGlobalCategoriesResult = GetApiPjGlobalCategoriesResult;
export type CreatePjGlobalCategoryResult = PostApiPjGlobalCategoriesResult;
export type UpdatePjGlobalCategoryResult = PatchApiPjGlobalCategoriesCategoryIdResult;
export type DeletePjGlobalCategoryResult = DeleteApiPjGlobalCategoriesCategoryIdResult;

export type ListPjClientCategoriesResult = GetApiPjClientIdCategoriesResult;
export type CreatePjClientCategoryResult = PostApiPjClientIdCategoriesResult;
export type UpdatePjClientCategoryResult = PatchApiPjClientIdCategoriesCategoryIdResult;
export type DeletePjClientCategoryResult = DeleteApiPjClientIdCategoriesCategoryIdResult;
