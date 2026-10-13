import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const callIdDefinition: JSONSchema7 = { type: 'string', minLength: 1, maxLength: 256 };

// pre_accept / accept: the agent's WebRTC SDP answer is required
export const cloudCallAnswerSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    callId: callIdDefinition,
    sdp: { type: 'string', minLength: 1, maxLength: 65536 },
    bizOpaqueCallbackData: { type: 'string', maxLength: 512 },
  },
  required: ['callId', 'sdp'],
};

// reject / terminate
export const cloudCallIdSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    callId: callIdDefinition,
  },
  required: ['callId'],
};

export const cloudCallSettingsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    calling: { type: 'object' },
  },
  required: ['calling'],
};
