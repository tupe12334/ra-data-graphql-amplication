import { IntrospectionOutputTypeRef, TypeKind } from "graphql";

const isRequired = (type: IntrospectionOutputTypeRef): boolean => {
  if (type.kind === TypeKind.LIST) {
    return isRequired(type.ofType);
  }

  return type.kind === TypeKind.NON_NULL;
};

export default isRequired;
