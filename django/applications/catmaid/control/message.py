# -*- coding: utf-8 -*-
from __future__ import unicode_literals

import json

from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render

from catmaid.models import Message, ChangeRequest
from catmaid.consumers import msg_user
from catmaid.control.common import makeJSON_legacy_list

from six.moves import map as imap

@login_required
def get_latest_unread_date(request):
    """ This method creates a response containing the date of the most recent
    message added. It is formatted as epoch time.
    """
    try:
        latest_date = int(Message.objects \
            .filter(user=request.user, read=False) \
            .order_by('-time') \
            .values_list('time', flat=True)[0].strftime('%s'))
    except IndexError:
        latest_date = None

    return HttpResponse(json.dumps({'latest_unread_date': latest_date}))


@login_required
def list_messages(request, project_id=None):
    messages = Message.objects.filter(
        user=request.user,
        read=False)\
    .order_by('-time')

    def message_to_dict(message):
        return {
            'id': message.id,
            'title': message.title,
            'action': message.action,
            'text': message.text,
            'time': str(message.time)
        }

    messages = list(imap(message_to_dict, messages))

    # Add a dummy message that includes the count of open notifications.
    # This is used to add the red badge to the notifications icon.
    crs = ChangeRequest.objects.filter(recipient = request.user, status = ChangeRequest.OPEN)
    messages += [{'id': -1, 'notification_count': len(crs)}]

    return HttpResponse(json.dumps(makeJSON_legacy_list(messages)))


@login_required
def read_message(request, message_id):
        message = get_object_or_404(Message, pk=message_id, user=request.user)
        message.read = True
        message.save()

        if message.action:
            return HttpResponseRedirect(message.action)
        else:
            return JsonResponse({
                'success': True
            })

def notify_user(user_id, message_id, message_title):
    """Send a ASGI message to the user, if a channel is available."""
    msg_user(user_id, "new-message", {
        "message_id": message_id,
        "message_title": message_title
    })
