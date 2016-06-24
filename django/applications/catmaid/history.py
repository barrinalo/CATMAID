from django.db import connection


def add_log_entry(user_id, label):
    """Give a label to the current transaction and time, executed by a
    particular user.
    """
    cursor = connection.cursor()
    cursor.execute("""
        INSERT INTO catmaid_transaction_info (user_id, change_type, label)
        VALUES (%s, 'Backend', %s)
    """, (user_id, label))


def record_request_action(label):
    """Give a label to the current transaction and time, executed by a Django
    user as provided by the wrapped function's request parameter. This
    parameter is first looked up in the function's keyword arguments and if not
    found, the request is expected to be provided as the first argument.
    """
    def decorator(f):
        def wrapped_f(*args, **kwargs):
            if 'request' in kwargs:
                user_id = kwargs['request'].user.id
            elif len(args) > 0:
                user_id = args[0].user.id
            else:
                raise ValueError("Couldn't find request to record action for")

            result = f(*args, **kwargs)
            print "Log", user_id, label
            add_log_entry(user_id, label)
            return result
        return wrapped_f
    return decorator


def record_action(user_id, label):
    """Give a label to the current transaction and time, executed by a
    particular user.
    """
    def decorator(f):
        def wrapped_f(*args, **kwargs):
            result = f(*args, **kwargs)
            add_log_entry(user_id, label)
            return result
        return wrapped_f
    return decorator