/**
 * @fileoverview Prevents calling this.emitUpdate() inside .onUpdate() callback functions
 *
 * See the documentation of propageUpdate in EventEmitter for more information.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow calling this.emitUpdate() inside .onUpdate() callback functions',
      category: 'Best Practices',
      recommended: true,
      url: 'https://github.com/AmbireTech/ambire-common/wiki/Controller-Update-Patterns'
    },
    fixable: 'code',
    schema: [],
    messages: {
      noEmitUpdateInOnUpdate:
        'Do not call this.emitUpdate() inside .onUpdate() callbacks. Use this.propagateUpdate(forceEmit) instead to properly propagate updates through the controller hierarchy.',
      autoFixApplied:
        'Automatically replaced this.emitUpdate() with this.propagateUpdate(forceEmit)'
    }
  },

  create(context) {
    // Stack to track when we're inside an onUpdate callback
    const onUpdateCallbackStack = []

    /**
     * Checks if a node is a CallExpression for .onUpdate()
     */
    function isOnUpdateCall(node) {
      return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'onUpdate'
      )
    }

    /**
     * Checks if a node is a CallExpression for this.emitUpdate()
     */
    function isEmitUpdateCall(node) {
      return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'ThisExpression' &&
        node.callee.property.type === 'Identifier' &&
        (node.callee.property.name === 'emitUpdate' ||
          node.callee.property.name === 'forceEmitUpdate')
      )
    }

    /**
     * Gets the forceEmit parameter name from the onUpdate callback
     */
    function getForceEmitParamName(callbackFunction) {
      if (
        callbackFunction &&
        callbackFunction.params &&
        callbackFunction.params.length > 0 &&
        callbackFunction.params[0].type === 'Identifier'
      ) {
        return callbackFunction.params[0].name
      }
      return 'forceEmit'
    }

    return {
      // When entering a CallExpression, check if it's .onUpdate()
      CallExpression(node) {
        if (isOnUpdateCall(node)) {
          // Get the callback function (first argument)
          const callback = node.arguments[0]

          if (
            callback &&
            (callback.type === 'FunctionExpression' || callback.type === 'ArrowFunctionExpression')
          ) {
            // Push the callback onto the stack with its forceEmit param name
            onUpdateCallbackStack.push({
              callback,
              // The param can then be used for auto-fixing
              forceEmitParam: getForceEmitParamName(callback)
            })
          }
        }

        // Check if we're inside an onUpdate callback and this is this.emitUpdate()
        if (onUpdateCallbackStack.length > 0 && isEmitUpdateCall(node)) {
          const currentContext = onUpdateCallbackStack[onUpdateCallbackStack.length - 1]
          const forceEmitParam = currentContext.forceEmitParam

          context.report({
            node,
            messageId: 'noEmitUpdateInOnUpdate',
            fix(fixer) {
              // Replace this.emitUpdate() with this.propagateUpdate(forceEmit)
              return fixer.replaceText(node, `this.propagateUpdate(${forceEmitParam})`)
            }
          })
        }
      },

      // When exiting a CallExpression that's .onUpdate(), pop from the stack
      'CallExpression:exit': function (node) {
        if (isOnUpdateCall(node)) {
          const callback = node.arguments[0]
          if (
            callback &&
            (callback.type === 'FunctionExpression' || callback.type === 'ArrowFunctionExpression')
          ) {
            // Pop the callback from the stack
            const top = onUpdateCallbackStack[onUpdateCallbackStack.length - 1]
            if (top && top.callback === callback) {
              onUpdateCallbackStack.pop()
            }
          }
        }
      }
    }
  }
}
