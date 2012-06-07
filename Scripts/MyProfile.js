/// <reference path="References.js" />

$(document).ready(function () {

    // Constants
    var serviceUrl = 'BigShelf-BigShelfService.svc';

    // Load our "profile" record
    var profile,
        profileDataSource = upshot.RemoteDataSource({
            providerParameters: {
                url: serviceUrl,
                operationName: "GetProfileForProfileUpdate"
            },
            provider: upshot.riaDataProvider,
            bufferChanges: true,
            refreshSuccess: function (profiles) {
                profile = profiles[0];
                render();
            }
        }).refresh();

    function render() {

        // Data-link "profile" in the <form> and page title, so our UI updates live.
        $("#profileForm").link(profile);
        $("#profileName").link(profile);

        // Set up validation of property fields, validation rules come from
        // the server where they were extracted from data annotations on the object's type
        $("#profileForm").validate({
            rules: profileDataSource.getEntityValidationRules().rules,
            errorPlacement: function (error, element) {
                error.appendTo(element.closest("tr"));
            }
        });

        // Set up UI styling updates in response to changes in the object
        $(profile).bind("propertyChange", function () {
            // When a property changes on the profile object enable the Cancel button. 
            // If all fields have passed validation, ALSO enable the Save button.
            updateSaveCancelButtonState();

            // If a property changes, we highlight the changed field in the UI
            updatePropertyAdornments();
        });

        // When profile leaves its "Unmodified" state, we'll enable the Save/Cancel buttons.
        // When we complete a save, we'll want to remove our updated scalar property adornments.
        profileDataSource.bind("entityStateChanged", function () {
            updatePropertyAdornments();
            updateSaveCancelButtonState();
        });

        // Bind the revert button on each form <input>.
        $("tr.profile-property.updated span.revertDelete").live("click", function () {
            var propertyName = $(this).siblings("input").attr("name");
            profileDataSource.revertUpdates(profile, propertyName);
        });

        // Bind our Save/Cancel buttons.
        $("#submit").click(function () { profileDataSource.commitChanges(); });
        $("#cancel").click(function () { profileDataSource.revertChanges(); });

        // Now let's implement the friends list which uses associated entities
        var friends = profile.Friends;

        // First, implement loading the friends list and populating a 
        // control with the result
        var friendsNames = {};
        var friendsList = $("#friend-list").list({
            data: friends,
            template: $("#profile-friend-template"),
            templateOptions: {
                getFriendName: function (friend) {
                    var profile = friend.FriendProfile;
                    if (profile) {
                        return profile.Name;
                    } else {
                        return friendsNames[friend.FriendId];
                    }
                }
            }
        }).data("list");

        // Now implement adding a friend once the friend has been populated in 
        // the add-friend-button <input> field
        $("#add-friend-button").click(function () {
            var friendId = $("#add-friend").data("friendId");
            friendsNames[friendId] = $("#add-friend-text").val();
            $.observable(friends).insert(friends.length, { FriendId: friendId });

            $("#add-friend-text").val("");
            $(this).disable();
        });


        // Now create an auto-complete over the add-friend-text <input> field
        // to make it easier to load friends into it
        $("#add-friend-text").autocomplete({
            source: function (term, callback) {
                var filter = [
                    { property: "Name", operator: "Contains", value: term.term },
                // Filter out the profile of the current user
                    {property: "Id", operator: "!=", value: profile.Id },
                ].concat($.map(friends, function (friend) {
                    // Filter out existing friends
                    return { property: "Id", operator: "!=", value: friend.FriendId };
                }));

                upshot.RemoteDataSource({
                    providerParameters: {
                        url: serviceUrl,
                        operationName: "GetProfiles"
                    },
                    provider: upshot.riaDataProvider,
                    filter: filter,
                    refreshSuccess: function (friendProfiles) {
                        // Transform each result into a label/foreignKey pair
                        callback($.map(friendProfiles, function (friend) {
                            return { label: friend.Name, foreignKey: friend.Id };
                        }));
                    }
                }).refresh();
            },
            select: function (event, data) {
                // Stow the foreign key value where our "Add Friend" button's click handler can find it.
                $("#add-friend").data("friendId", data.item.foreignKey);

                // Enable the "Add Friend" button since we have a selected friend to add 
                $("#add-friend-button").enable().focus();
            }
        }).keyup(function (event) {
            // Any keystroke that doesn't select a Friend should disable the "Add Friend" button
            if (event.keyCode !== 13) {
                $("#add-friend-button").disable();
            }
        }).watermark();

        // Update the Submit / Cancel button state when a friend is reverted
        $([friends]).bind("arrayChange", function () {
            updateSaveCancelButtonState();
        });


        // For each Friend child entity, transitioning from the "Unmodified" entity state
        // indicates an add/remove.  Such a change should update our per-entity added/removed styling.  
        // It should also enable/disable our Save/Cancel buttons.
        upshot.EntitySource.as(friends).bind({
            entityStateChanged: function (entity, state) {
                updateFriendAddDeleteAdornment(entity);
                updateSaveCancelButtonState();
            }
        });

        // Bind revert/delete button on friends.
        // It's convenient to use "live" here to bind/unbind these handlers as child entities are added/removed.
        $("#friend-list span.revertDelete").live("click", function () {
            var friendElement = $(this).closest(".friend-item"),
                friend = friendsList.dataForNode(friendElement[0]),
                friendsEntitySource = upshot.EntitySource.as(friends);
            if (friendElement.hasClass("deleted") || friendElement.hasClass("added")) {
                friendsEntitySource.revertChanges(friend);
            } else {
                friendsEntitySource.deleteEntity(friend);
            }
        });

        //
        // Helper functions
        //

        function updateSaveCancelButtonState() {
            var haveChanges = hasChanges(profileDataSource) || hasChanges(upshot.EntitySource.as(friends));
            var changesValid = $("#profileForm").valid();
            $("#submit").toggleEnabled(haveChanges && changesValid);

            // Can cancel changes regardless if they are valid or not
            $("#cancel").toggleEnabled(haveChanges);

            function hasChanges(dataSource) {
                return $.grep(dataSource.getEntities(), function (entity) {
                    switch (dataSource.getEntityState(entity)) {
                        case upshot.EntityState.ClientUpdated:
                        case upshot.EntityState.ClientAdded:
                        case upshot.EntityState.ClientDeleted:
                            return true;

                        case upshot.EntityState.Unmodified:  // No changes to commit.
                        case upshot.EntityState.ServerUpdating:  // Commit is in progress, so disable Save/Cancel button.
                        case upshot.EntityState.ServerAdding:
                        case upshot.EntityState.ServerDeleting:
                            return false;
                    }
                }).length > 0;
            };
        };

        function updatePropertyAdornments() {
            $("tr.profile-property")
                .removeClass("updated")
                .filter(function () {
                    return isModifiedProfileProperty($(this).find("input").attr("name"));
                })
                .addClass("updated");

            function isModifiedProfileProperty(propertyName) {
                var profileEntityState = profileDataSource.getEntityState(profile)
                switch (profileEntityState) {
                    case upshot.EntityState.ClientUpdated:  // Profile entity is only updated on the client.
                    case upshot.EntityState.ServerUpdating:  // Profile entity is updated on the client and sync'ing with server (but unconfirmed).
                        return profileDataSource.isUpdated(profile, propertyName);

                    default:
                        return false;
                }
            };
        };

        function updateFriendAddDeleteAdornment(friend) {
            var entityState = upshot.EntitySource.as(friends).getEntityState(friend) || "";
            var isDeleted = entityState === upshot.EntityState.ClientDeleted || entityState === upshot.EntityState.ServerDeleting;
            var isAdded = entityState === upshot.EntityState.ClientAdded || entityState === upshot.EntityState.ServerAdding;

            var friendsListItemElement = friendsList.nodeForData(friend);
            $(friendsListItemElement)
                .toggleClass("deleted", isDeleted)
                .toggleClass("added", isAdded);
        };
    };
});
