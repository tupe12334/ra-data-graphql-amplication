import { GET_LIST, GET_MANY, GET_MANY_REFERENCE, DELETE } from "ra-core";
import { QUERY_TYPES } from "ra-data-graphql";
import { TypeKind } from "graphql";
import * as gqlTypes from "graphql-ast-types-browser";

import getFinalType from "./getFinalType";
import isList from "./isList";
import isRequired from "./isRequired";
import {
  FetchType,
  IntrospectionResults,
  QueryType,
  Resource,
  Variables,
  IntrospectionInputValue,
  IntrospectionUnionType,
  IntrospectionObjectType,
  IntrospectionField,
} from "./types";

export const buildFragments =
  (introspectionResults: IntrospectionResults) =>
  (possibleTypes: Readonly<any[]>) =>
    possibleTypes.reduce((acc, possibleType) => {
      const type = getFinalType(possibleType);

      const linkedType = introspectionResults.types.find(
        (t) => t.name === type.name
      );

      return [
        ...acc,
        gqlTypes.inlineFragment(
          gqlTypes.selectionSet(
            buildFields(introspectionResults)(
              (linkedType as IntrospectionObjectType)?.fields
            )
          ),
          gqlTypes.namedType(gqlTypes.name(type.name))
        ),
      ];
    }, [] as any[]);

export const buildFields =
  (introspectionResults: IntrospectionResults, path: String[] = []) =>
  (fields: Readonly<IntrospectionField[]>): any =>
    fields.reduce((acc, field) => {
      const type = getFinalType(field.type);

      if (type.name.startsWith("_")) {
        return acc;
      }

      if (type.kind !== TypeKind.OBJECT && type.kind !== TypeKind.INTERFACE) {
        return [...acc, gqlTypes.field(gqlTypes.name(field.name))];
      }

      const linkedResource = introspectionResults.resources.find(
        (r) => r.type.name === type.name
      );

      if (linkedResource) {
        return [
          ...acc,
          gqlTypes.field(
            gqlTypes.name(field.name),
            null,
            null,
            null,
            gqlTypes.selectionSet([gqlTypes.field(gqlTypes.name("id"))])
          ),
        ];
      }

      const linkedType = introspectionResults.types.find(
        (t) => t.name === type.name
      );

      if (linkedType && !path.includes(linkedType.name)) {
        return [
          ...acc,
          gqlTypes.field(
            gqlTypes.name(field.name),
            null,
            null,
            null,
            gqlTypes.selectionSet([
              ...buildFragments(introspectionResults)(
                (linkedType as IntrospectionUnionType).possibleTypes || []
              ),
              ...buildFields(introspectionResults, [...path, linkedType.name])(
                (linkedType as IntrospectionObjectType).fields
              ),
            ])
          ),
        ];
      }

      // NOTE: We might have to handle linked types which are not resources but will have to be careful about
      // ending with endless circular dependencies
      return acc;
    }, [] as any[]);

export const getArgType = (arg: IntrospectionInputValue) => {
  const type = getFinalType(arg.type);
  const required = isRequired(arg.type);
  const list = isList(arg.type);

  if (list) {
    if (required) {
      return gqlTypes.listType(
        gqlTypes.nonNullType(gqlTypes.namedType(gqlTypes.name(type.name)))
      );
    }
    return gqlTypes.listType(gqlTypes.namedType(gqlTypes.name(type.name)));
  }

  if (required) {
    return gqlTypes.nonNullType(gqlTypes.namedType(gqlTypes.name(type.name)));
  }

  return gqlTypes.namedType(gqlTypes.name(type.name));
};

export const buildArgs = (query: QueryType, variables: Variables) => {
  if (query.args.length === 0) {
    return [];
  }

  const validVariables = Object.keys(variables).filter(
    (k) => typeof variables[k] !== "undefined"
  );
  let args = query.args
    .filter((a) => validVariables.includes(a.name))
    .reduce(
      (acc, arg) => [
        ...acc,
        gqlTypes.argument(
          gqlTypes.name(arg.name),
          gqlTypes.variable(gqlTypes.name(arg.name))
        ),
      ],
      [] as any[]
    );

  return args;
};

export const buildApolloArgs = (query: QueryType, variables: Variables) => {
  if (query.args.length === 0) {
    return [];
  }

  const validVariables = Object.keys(variables).filter(
    (k) => typeof variables[k] !== "undefined"
  );

  let args = query.args
    .filter((a) => validVariables.includes(a.name))

    .reduce((acc, arg) => {
      return [
        ...acc,
        gqlTypes.variableDefinition(
          gqlTypes.variable(gqlTypes.name(arg.name)),
          getArgType(arg)
        ),
      ];
    }, [] as any[]);

  return args;
};

const buildGqlQuery =
  (introspectionResults: IntrospectionResults) =>
  (
    resource: Resource,
    aorFetchType: FetchType,
    queryType: QueryType,
    variables: Variables
  ) => {
    const { sortField, sortOrder, ...metaVariables } = variables;
    const apolloArgs = buildApolloArgs(queryType, variables);
    const args = buildArgs(queryType, variables);
    const metaArgs = buildArgs(queryType, metaVariables);
    const fields = buildFields(introspectionResults)(resource.type.fields);
    if (
      aorFetchType === GET_LIST ||
      aorFetchType === GET_MANY ||
      aorFetchType === GET_MANY_REFERENCE
    ) {
      return gqlTypes.document([
        gqlTypes.operationDefinition(
          "query",
          gqlTypes.selectionSet([
            gqlTypes.field(
              gqlTypes.name(queryType.name),
              gqlTypes.name("items"),
              args,
              null,
              gqlTypes.selectionSet(fields)
            ),

            gqlTypes.field(
              gqlTypes.name(`_${queryType.name}Meta`),
              gqlTypes.name("total"),
              metaArgs,
              null,
              gqlTypes.selectionSet([gqlTypes.field(gqlTypes.name("count"))])
            ),
          ]),
          gqlTypes.name(queryType.name),
          apolloArgs
        ),
      ]);
    }

    if (aorFetchType === DELETE) {
      return gqlTypes.document([
        gqlTypes.operationDefinition(
          "mutation",
          gqlTypes.selectionSet([
            gqlTypes.field(
              gqlTypes.name(queryType.name),
              gqlTypes.name("data"),
              args,
              null,
              gqlTypes.selectionSet(fields)
            ),
          ]),
          gqlTypes.name(queryType.name),
          apolloArgs
        ),
      ]);
    }

    return gqlTypes.document([
      gqlTypes.operationDefinition(
        QUERY_TYPES.includes(aorFetchType) ? "query" : "mutation",
        gqlTypes.selectionSet([
          gqlTypes.field(
            gqlTypes.name(queryType.name),
            gqlTypes.name("data"),
            args,
            null,
            gqlTypes.selectionSet(fields)
          ),
        ]),
        gqlTypes.name(queryType.name),
        apolloArgs
      ),
    ]);
  };

export default buildGqlQuery;
