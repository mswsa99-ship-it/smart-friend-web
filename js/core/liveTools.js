// أدوات يستدعيها Gemini أثناء المحادثة — مطابقة لـ LiveTools.kt
import { evaluate } from './calculator.js';

export const CALCULATE = 'calculate';

export function declarations() {
  return [{
    functionDeclarations: [{
      name: CALCULATE,
      description: 'يحسب أي عملية حسابية بدقة تامة: + - * / والقوى ^ والكسور والأقواس والجذر sqrt(). ' +
        'استخدمه دائمًا قبل قول أي نتيجة حسابية للطفل، وقبل الحكم على إجابته.',
      parameters: {
        type: 'OBJECT',
        properties: { expression: { type: 'STRING', description: 'العملية بالأرقام، مثل 5^6 أو (2+3)*4 أو 1/2+1/3 أو sqrt(144)' } },
        required: ['expression'],
      },
    }],
  }];
}

/** يجيب على toolCall برسالة toolResponse */
export function respond(toolCall) {
  const functionResponses = (toolCall?.functionCalls || []).map((c) => {
    const response = {};
    if (c.name === CALCULATE) {
      const r = evaluate(c.args?.expression ?? '');
      if (r.startsWith('خطأ')) response.error = r; else response.result = r;
    } else {
      response.error = `أداة غير معروفة: ${c.name}`;
    }
    return { id: c.id ?? '', name: c.name, response };
  });
  return { toolResponse: { functionResponses } };
}
