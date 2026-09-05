import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = Symbol('IS_PUBLIC_ROUTE');
export const LOCAL_SAVE_ACCESS = Symbol('LOCAL_SAVE_ACCESS');

export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);
export const LocalSaveRoute = () => SetMetadata(LOCAL_SAVE_ACCESS, 'route');
export const LocalSaveInput = () => SetMetadata(LOCAL_SAVE_ACCESS, 'input');
