
import { useEffect, useState } from 'react';
import { readComponentProperties } from '../../features/componentProperties/propertiesBridge';
import { listPropsOf, type ListProp } from '../../editor/listProps';

const NO_LIST_PROPS: ReadonlyMap<string, ListProp> = new Map();

export function useListProps(projectPath: string | undefined, componentPath: string | undefined): ReadonlyMap<string, ListProp> {
  const [read, setRead] = useState<{ readonly key: string; readonly props: ReadonlyMap<string, ListProp> } | undefined>(undefined);
  const key = `${projectPath ?? ''}|${componentPath ?? ''}`;
  useEffect(() => {
    if (projectPath === undefined || componentPath === undefined) {
      return undefined;
    }
    let live = true;
    readComponentProperties(projectPath, componentPath).then(
      (result) => {
        if (live && result.ok) {
          setRead({ key, props: listPropsOf(frontmatterOf(result.value.source)) });
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [projectPath, componentPath, key]);
  return read?.key === key ? read.props : NO_LIST_PROPS;
}

function frontmatterOf(source: string): string {
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return match?.[1] ?? '';
}
