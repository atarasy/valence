import {DEPLOYMENT_ID} from './identity.ts';
import {memberEntry} from './serve.ts';
import type {MemberRuntimeConfig} from '../config.ts';
import config from './config.json';
import aasa from './aasa.json';
export {failureReason} from './serve.ts';
export default memberEntry(DEPLOYMENT_ID,config as MemberRuntimeConfig,aasa);
