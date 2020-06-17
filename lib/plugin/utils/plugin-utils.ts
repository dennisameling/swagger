import { head } from 'lodash';
import { dirname, posix } from 'path';
import * as ts from 'typescript';
import {
  getDecoratorName,
  getText,
  getTypeArguments,
  isArray,
  isBoolean,
  isEnum,
  isInterface,
  isNumber,
  isString
} from './ast-utils';

export function getDecoratorOrUndefinedByNames(
  names: string[],
  decorators: ts.NodeArray<ts.Decorator>
): ts.Decorator | undefined {
  return (decorators || ts.createNodeArray()).find((item) =>
    names.includes(getDecoratorName(item))
  );
}

export function getTypeReferenceAsString(
  type: ts.Type,
  typeChecker: ts.TypeChecker
): string {
  if (isArray(type)) {
    const arrayType = getTypeArguments(type)[0];
    const elementType = getTypeReferenceAsString(arrayType, typeChecker);
    if (!elementType) {
      return undefined;
    }
    return `[${elementType}]`;
  }
  if (isBoolean(type)) {
    return Boolean.name;
  }
  if (isNumber(type)) {
    return Number.name;
  }
  if (isString(type)) {
    return String.name;
  }
  if (isPromiseOrObservable(getText(type, typeChecker))) {
    const typeArguments = getTypeArguments(type);
    const elementType = getTypeReferenceAsString(
      head(typeArguments),
      typeChecker
    );
    if (!elementType) {
      return undefined;
    }
    return elementType;
  }
  if (type.isClass()) {
    return getText(type, typeChecker);
  }
  try {
    const text = getText(type, typeChecker);
    if (text === Date.name) {
      return text;
    }
    if (
      isAutoGeneratedTypeUnion(type) ||
      isAutoGeneratedEnumUnion(type, typeChecker)
    ) {
      const types = (type as ts.UnionOrIntersectionType).types;
      return getTypeReferenceAsString(types[types.length - 1], typeChecker);
    }
    if (
      text === 'any' ||
      text === 'unknown' ||
      text === 'object' ||
      isInterface(type) ||
      (type.isUnionOrIntersection() && !isEnum(type))
    ) {
      return 'Object';
    }
    if (isEnum(type)) {
      return undefined;
    }
    if (type.aliasSymbol) {
      return 'Object';
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function isPromiseOrObservable(type: string) {
  return type.includes('Promise') || type.includes('Observable');
}

export function hasPropertyKey(
  key: string,
  properties: ts.NodeArray<ts.PropertyAssignment>
): boolean {
  return properties
    .filter((item) => !isDynamicallyAdded(item))
    .some((item) => item.name.getText() === key);
}

export function replaceImportPath(typeReference: string, fileName: string) {
  if (!typeReference.includes('import')) {
    return typeReference;
  }
  let importPath = /\(\"([^)]).+(\")/.exec(typeReference)[0];
  if (!importPath) {
    return undefined;
  }
  importPath = importPath.slice(2, importPath.length - 1);

  let relativePath = posix.relative(dirname(fileName), importPath);
  relativePath = relativePath[0] !== '.' ? './' + relativePath : relativePath;

  const nodeModulesText = 'node_modules';
  const nodeModulePos = relativePath.indexOf(nodeModulesText);
  if (nodeModulePos >= 0) {
    relativePath = relativePath.slice(
      nodeModulePos + nodeModulesText.length + 1 // slash
    );

    const typesText = '@types';
    const typesPos = relativePath.indexOf(typesText);
    if (typesPos >= 0) {
      relativePath = relativePath.slice(
        typesPos + typesText.length + 1 //slash
      );
    }

    const indexText = '/index';
    const indexPos = relativePath.indexOf(indexText);
    if (indexPos >= 0) {
      relativePath = relativePath.slice(0, indexPos);
    }
  }

  typeReference = typeReference.replace(importPath, relativePath);
  return typeReference.replace('import', 'require');
}

export function isDynamicallyAdded(identifier: ts.Node) {
  return identifier && !identifier.parent && identifier.pos === -1;
}

/**
 * when "strict" mode enabled, TypeScript transform the enum type to a union composed of
 * the enum values and the undefined type. Hence, we have to lookup all the union types to get the original type
 * @param type
 * @param typeChecker
 */
export function isAutoGeneratedEnumUnion(
  type: ts.Type,
  typeChecker: ts.TypeChecker
): ts.Type {
  if (type.isUnionOrIntersection() && !isEnum(type)) {
    if (!type.types) {
      return undefined;
    }
    const undefinedTypeIndex = type.types.findIndex(
      (type: any) => type.intrinsicName === 'undefined'
    );
    if (undefinedTypeIndex < 0) {
      return undefined;
    }

    // "strict" mode for enums
    let parentType = undefined;
    const isParentSymbolEqual = type.types.every((item, index) => {
      if (index === undefinedTypeIndex) {
        return true;
      }
      if (!item.symbol) {
        return false;
      }
      if (
        !(item.symbol as any).parent ||
        item.symbol.flags !== ts.SymbolFlags.EnumMember
      ) {
        return false;
      }
      const symbolType = typeChecker.getDeclaredTypeOfSymbol(
        (item.symbol as any).parent
      );
      if (symbolType === parentType || !parentType) {
        parentType = symbolType;
        return true;
      }
      return false;
    });
    if (isParentSymbolEqual) {
      return parentType;
    }
  }
  return undefined;
}

/**
 * when "strict" mode enabled, TypeScript transform the type signature of optional properties to
 * the {undefined | T} where T is the original type. Hence, we have to extract the last type of type union
 * @param type
 */
export function isAutoGeneratedTypeUnion(type: ts.Type): boolean {
  if (type.isUnionOrIntersection() && !isEnum(type)) {
    if (!type.types) {
      return false;
    }
    const undefinedTypeIndex = type.types.findIndex(
      (type: any) => type.intrinsicName === 'undefined'
    );

    // "strict" mode for non-enum properties
    if (type.types.length === 2 && undefinedTypeIndex >= 0) {
      return true;
    }
  }
  return false;
}

export function extractTypeArgumentIfArray(type: ts.Type) {
  if (isArray(type)) {
    type = getTypeArguments(type)[0];
    if (!type) {
      return undefined;
    }
    return {
      type,
      isArray: true
    };
  }
  return {
    type,
    isArray: false
  };
}
