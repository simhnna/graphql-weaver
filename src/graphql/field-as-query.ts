import {
    ASTNode, DocumentNode, FieldNode, FragmentDefinitionNode, FragmentSpreadNode, GraphQLResolveInfo,
    OperationDefinitionNode, OperationTypeNode, SelectionNode, SelectionSetNode, VariableDefinitionNode, VariableNode,
    visit
} from 'graphql';
import { Query } from './common';
import {flatMap} from "../utils/utils";

type QueryParts = {
    fragments: FragmentDefinitionNode[],
    selectionSet: SelectionSetNode,
    variableDefinitions: VariableDefinitionNode[],
    variableValues: { [name: string]: any }
    operation: OperationTypeNode;
};

/**
 * Prepares all the parts necessary to construct a GraphQL query document like produced by getFieldAsQuery
 */
export function getFieldAsQueryParts(info: GraphQLResolveInfo): QueryParts {
    const fragments = collectUsedFragments(info.fieldNodes, info.fragments);
    const selections = collectSelections(info.fieldNodes);
    const selectionSet: SelectionSetNode = {
        kind: 'SelectionSet',
        selections
    };
    const variableNames = collectUsedVariableNames([...fragments, ...info.fieldNodes]);
    const variableDefinitions = (info.operation.variableDefinitions || [])
        .filter(variable => variableNames.has(variable.variable.name.value));
    const variableValues = pickIntoObject(info.variableValues, Array.from(variableNames));
    const operation = info.operation.operation;

    return {fragments, variableDefinitions, variableValues, selectionSet, operation};
}

/**
 * Constructs a GraphQL query document from a field as seen by a resolver
 *
 * This is the basic component of a proxy - a resolver calls this method and then sends the query to the upstream server
 */
export function getFieldAsQuery(info: GraphQLResolveInfo): Query {
    return getQueryFromParts(getFieldAsQueryParts(info));
}

export function getQueryFromParts(parts: QueryParts) {
    const {fragments, variableDefinitions, variableValues, selectionSet, operation} = parts;

    const operationNode: OperationDefinitionNode = {
        kind: 'OperationDefinition',
        operation,
        variableDefinitions,
        selectionSet
    };

    const document: DocumentNode = {
        kind: 'Document',
        definitions: [
            operationNode,
            ...fragments
        ]
    };

    return {
        document,
        variableValues
    };
}

function collectDirectlyUsedFragmentNames(roots: ASTNode[]): string[] {
    const fragments = new Set<string>();
    for (const root of roots) {
        visit(root, {
            FragmentSpread(node: FragmentSpreadNode) {
                fragments.add(node.name.value);
            }
        });
    }
    return Array.from(fragments);
}

function collectUsedVariableNames(roots: ASTNode[]): Set<string> {
    const variables = new Set<string>();
    for (const root of roots) {
        visit(root, {
            Variable(node: VariableNode) {
                variables.add(node.name.value);
            }
        });
    }
    return variables;
}

function collectUsedFragments(roots: ASTNode[], fragmentMap: { [name: string]: FragmentDefinitionNode }) {
    let fragments: FragmentDefinitionNode[] = [];
    let originalFragments = new Set<FragmentDefinitionNode>();
    let hasChanged = false;
    do {
        const newFragments = pickIntoArray(fragmentMap, collectDirectlyUsedFragmentNames(roots.concat(fragments))); // seemds odd to be cummulative here
        hasChanged = false;
        for (const fragment of newFragments) {
            if (!originalFragments.has(fragment)) {
                originalFragments.add(fragment);
                fragments.push(fragment);
                hasChanged = true;
            }
        }
    } while (hasChanged);
    return fragments;
}

/**
 * Collects the selections of all given field nodes
 * @param fieldNodes the selections
 * @returns {any}
 */
function collectSelections(fieldNodes: FieldNode[]): SelectionNode[] {
    return flatMap(fieldNodes, node => node.selectionSet ? node.selectionSet.selections : []);
}

function pickIntoArray<TValue>(object: { [key: string]: TValue }, keys: string[]): TValue[] {
    return keys.map(key => object[key]);
}

function pickIntoObject<TValue>(object: { [key: string]: TValue }, keys: string[]): { [key: string]: TValue } {
    const obj: { [key: string]: TValue } = {};
    for (const key of keys) {
        obj[key] = object[key];
    }
    return obj;
}
