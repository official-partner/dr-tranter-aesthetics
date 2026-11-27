
import { assert } from '../../shared/core/assert';
import type {
  RemoteAsset,
  RemoteAssetKind,
  RemoteCollection,
  RemoteDocument,
  RemoteDocumentAction,
  RemoteDocumentList,
  RemoteDocumentSummary,
  RemoteMove,
  RemoteReferenceOption,
  RemoteRevision,
  RemoteWrite,
} from '../../shared/properties/cmsRemote';
import {
  sanityCollections,
  sanityDocument,
  sanityDocuments,
  sanityReferenceOptions,
  sanityTemplate,
  sanityWriteDraft,
  type SanityDataset,
} from './sanityContent';
import { sanityAct, sanityCreateDraft, sanityDelete, sanityMove } from './sanityEdits';
import { sanityRestore, sanityRevisions } from './sanityHistory';
import { sanityConstantLists, sanityDocumentSchema, sanityNamedTypes, sanityTypeIcons } from './sanitySchema';
import { inStructureOrder, sanityStructureOrder } from './sanityStructure';
import { sanityUploadBytes } from './sanityUpload';
import { cmsNetworkProblem } from './cmsNetworkFailure';
import { DescribedError } from '../../shared/properties/describedError';
import { described, type Described } from '../../shared/properties/i18n/messageRef';

export interface CmsRemoteService {
  readonly collections: () => Promise<RemoteCollection[]>;
  readonly documents: (collection: string, columns?: readonly string[]) => Promise<RemoteDocumentList>;
  readonly create: (collection: string) => Promise<RemoteDocumentSummary>;
  readonly remove: (ids: readonly string[]) => Promise<number>;
  readonly move: (move: RemoteMove) => Promise<RemoteDocumentList>;
  readonly document: (id: string) => Promise<RemoteDocument>;
  readonly template: (collection: string) => Promise<RemoteDocument>;
  readonly write: (write: RemoteWrite) => Promise<RemoteDocument>;
  readonly act: (id: string, action: RemoteDocumentAction) => Promise<RemoteDocument | undefined>;
  readonly history: (id: string) => Promise<RemoteRevision[]>;
  readonly restore: (id: string, revision: string) => Promise<RemoteDocument>;
  readonly references: (types: readonly string[], query?: string) => Promise<RemoteReferenceOption[]>;
  readonly upload: (kind: RemoteAssetKind, file: { readonly name: string; readonly bytes: Uint8Array }) => Promise<RemoteAsset>;
  readonly uploadBytesMax?: number;
}

export function cmsRemoteService(root: string, target: SanityDataset): CmsRemoteService {
  assert(root.length > 0, 'A CMS service belongs to a project');
  assert(target.token.length > 0, 'A CMS service holds a key');
  const schemaOf = () => {
    const named = sanityNamedTypes(root);
    const lists = sanityConstantLists(root);
    return (type: string) => sanityDocumentSchema(named, type, lists);
  };
  const previewFor = (type: string) => sanityDocumentSchema(sanityNamedTypes(root), type)?.preview;
  const documents = (collection: string, columns: readonly string[] = []) => sanityDocuments(target, collection, previewFor(collection), columns);
  const document = (id: string) => sanityDocument(target, id, schemaOf());
  return {
    collections: async () => {
      const collections = await sanityCollections(target);
      const names = collections.map((collection) => collection.name);
      const order = inStructureOrder(names, sanityStructureOrder(root, names));
      const icons = sanityTypeIcons(root);
      return order.flatMap((name) => collections.filter((entry) => entry.name === name).map((entry) => ({ ...entry, icon: icons.get(name) })));
    },
    documents,
    create: async (collection) => {
      const list = await sanityDocuments(target, collection);
      return sanityCreateDraft(target, collection, { orderable: list.orderable });
    },
    remove: (ids) => sanityDelete(target, ids),
    move: async (move) => {
      await sanityMove(target, move);
      return documents(move.collection);
    },
    document,
    template: async (collection) => sanityTemplate(collection, schemaOf()),
    write: async (write) => {
      await sanityWriteDraft(target, write);
      return document(write.id);
    },
    act: async (id, action) => {
      await sanityAct(target, id, action);
      return document(id).catch(() => undefined);
    },
    history: (id) => sanityRevisions(target, id),
    restore: async (id, revision) => {
      await sanityRestore(target, id, revision);
      return document(id);
    },
    references: (types) => {
      const named = sanityNamedTypes(root);
      return sanityReferenceOptions(target, types, (type) => sanityDocumentSchema(named, type)?.preview?.media);
    },
    upload: (kind, file) => sanityUploadBytes(target, kind, file.name, file.bytes),
  };
}

export function cmsFailureProblem(error: unknown): Described {
  if (error instanceof DescribedError) {
    return error.problem;
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error instanceof TypeError) {
      return cmsNetworkProblem(error, undefined);
    }
    return error.message.length > 0 ? { message: error.message } : described('cmsBackend.network.failed');
  }
  const text = String(error);
  return text.length > 0 ? { message: text } : described('cmsBackend.network.failed');
}

export function cmsFailureMessage(error: unknown): string {
  return cmsFailureProblem(error).message;
}
