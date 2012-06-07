/// <reference path="References.js" />

$(document).ready(function () {

    // Constants
    var serviceUrl = "BigShelf-BigShelfService.svc",
        pageSize = 6;

    var Sort = {
        None: 0,
        Title: 1,
        Author: 2,
        Rating: 3,
        MightRead: 4
    };

    // Load our "profile" record, including those flagged books belonging to this profile.
    var profile,
        profileDataSource = upshot.RemoteDataSource({
            providerParameters: {
                url: serviceUrl,
                operationName: "GetProfileForSearch"
            },
            provider: upshot.riaDataProvider,
            refreshSuccess: function (profiles) {
                profile = profiles[0];
                render();
            }
        }).refresh();

    function render() {
        var remoteBooks, books = [], remoteBooksQueryParameters = {};
        var View = {
            All: 1,
            MyBooks: 2,
            JustFriends: 3
        }, currentView;

        // A list UI control over our "books" array.
        var booksList = $("#books").list({
            data: books,
            template: $("#bookTemplate"),
            itemAdded: function (book, elements) {
                // Bind edit controls on each book element to a FlaggedBook entity for "profile".
                enableFlaggingForBook(book, elements[0]);
            }
        }).data("list");

        // Our "Show Me:" nav bar.
        $(".filterButton").click(function () {
            var $this = $(this);
            if (!$this.hasClass("selected")) {
                // Toggle the selection
                $('.filterButton.selected').removeClass("selected");
                $this.addClass("selected");

                // Change the view based on what's clicked in "Show Me:".
                switchView($this.data("book-view"));
            }
        });

        // A friends filter used only by "Show Me: Just friends".
        $.each(profile.Friends, function () {
            var friendHtml = $("#friendsListTemplate").render(this);
            $(friendHtml)
                .appendTo($("#friendsList"))
                .filter(".friendButton")
                .data("friendId", this.FriendId)
                .click(function () {
                    $(this).toggleClass("selected");

                    // Refresh those books displayed, based on changes to the friends filter.
                    refreshBooksList();
                });
        });

        // Our "Sort By:" sort control.
        $(".sortButton").click(function () {
            var $this = $(this);
            if (!$this.hasClass("selected")) {
                // Toggle the selection
                $(".sortButton.selected").removeClass("selected");
                $this.addClass("selected");

                // Changing our sort should move us back to page 0.  Don't refresh here.  Do so below.
                $("#pager").pager("setPage", { page: 0, refresh: false });

                // Refresh those books displayed, based on the new sort.
                refreshBooksList();
            }
        })
        .eq(0).addClass("selected");

        // A "search" text box to do substring searches on book title.
        $("#searchBox").autocomplete({
            source: function () {
                // A pause in typing in our search control should refresh the search results.
                refreshBooksList();
            },
            minLength: 0
        }).watermark();

        // A pager control over books.  We'll configure the pager with a data source as we "switchView" below.
        $("#pager").pager({
            template: "#pageNumberTemplate",
            currentClass: "selected",
            pageSize: pageSize
        });

        // Flagged books should be disabled in the UI while they're being sync'd with the server.
        upshot.EntitySource.as(profile.FlaggedBooks).bind({
            entityStateChanged: function (flaggedBook, entityState) {
                var savingFlaggedBook = entityState === upshot.EntityState.ServerAdding || entityState === upshot.EntityState.ServerUpdating,
                    bookElement = booksList.nodeForData(flaggedBook.Book);
                $(bookElement).toggleClass("disabled", savingFlaggedBook);
            }
        });

        // Trigger a click on "Show Me: All" to fetch our initial page of book data.
        $(".filterButton").eq(0).click();

        //
        // Helper functions
        //

        function switchView(newView) {
            if (currentView) {
                // Destroy the data sources that supported previous view.
                upshot.EntitySource.as(books).dispose();
                if (currentView === View.MyBooks) {
                    upshot.EntitySource.as(remoteBooks).dispose();
                }

                // Empty our books array, so we can reload it to for the newly selected view.
                $.observable(books).refresh([]);
            }

            // The friends filter is only used for the "Show Me: Just friends" view.
            $("#friendsList")[newView === View.JustFriends ? "show" : "hide"]();

            // Create a data source to support the newly selected view.
            var newDataSource;
            if (newView === View.MyBooks) {
                // Here, using a remote data source, we load all books flagged for the current profile 
                // into "remoteBooks".  Then, we populate our "books" array (rendered into our list control)
                // using a local data source.  This local data source does (fast) paging/sorting/filtering 
                // in memory, in JavaScript against "remoteBooks".
                remoteBooks = [];
                newDataSource = upshot.LocalDataSource({
                    source: createRemoteDataSource(remoteBooks),
                    result: books 
                });
            } else {
                newDataSource = createRemoteDataSource(books);
            }

            // Configure our pager with the new data source.
            $("#pager").pager("option", "dataSource", newDataSource);

            // Configure our new data source so that, while a refresh is in progress, we make the UI appear disabled.
            newDataSource
                .bind("refreshStart", function () { $("#content").addClass("disabled"); })
                .bind("refreshSuccess", function () { $("#content").removeClass("disabled"); });

            currentView = newView;

            // Have our new data source load the contents of our "books" array.
            refreshBooksList(true);
        };

        function createRemoteDataSource(resultArray) {
            return upshot.RemoteDataSource({
                result: resultArray,
                providerParameters: {
                    url: serviceUrl,
                    operationName: "GetBooksForSearch",
                    operationParameters: remoteBooksQueryParameters
                },
                dataContext: profileDataSource.getDataContext()
                // With "dataContext" here, books from "profile.FlaggedBooks.Book" and "books" will be the same objects.
                // See the use of "===" in getFlaggedBook below.
            });
        };

        function refreshBooksList(refreshAll) {
            var dataSource = upshot.EntitySource.as(books);

            // Filter books by title, based on the substring from our search box.
            var titleSubstring = $("#searchBox").val() || "";
            dataSource.setFilter({ property: "Title", operator: "Contains", value: titleSubstring });

            // Determine the profile id's for which we're fetching books.
            switch (currentView) {
                case View.All:
                    remoteBooksQueryParameters.profileIds = null;
                    break;
                case View.MyBooks:
                    remoteBooksQueryParameters.profileIds = [profile.Id];
                    break;
                case View.JustFriends:
                    // Determine the profile id's based on friends selected in our friends filter.
                    remoteBooksQueryParameters.profileIds = $(".friendButton.selected").map(function () {
                        return $(this).data("friendId");
                    }).toArray();
                    break;
            }

            // Determine sort.  Unfortunately, the sort we use for "Rating" and "Might Read" is more complex than
            // a simple {property, direction}-pair, so we have to treat the local and remote querying cases separately.
            // In many apps, database views are designed to turn a complex sort like this into a simpler one over 
            // a single entity type.  We've kept the more complex sort below to better illustrate Upshot use.
            var currentSort = $(".sortButton.selected").data("book-sort");

            if (currentView === View.MyBooks) {
                remoteBooksQueryParameters.sort = Sort.None;
                upshot.EntitySource.as(books).setSort(getLocalSort(currentSort));
            } else {
                remoteBooksQueryParameters.sort = currentSort;
                remoteBooksQueryParameters.sortAscending = currentSort === Sort.Title || currentSort === Sort.Author;
            }

            // Refresh our books data source.
            dataSource.refresh({ all: refreshAll });
        };

        function getLocalSort(sort) {
            switch (sort) {
                case Sort.Title:
                case Sort.Author:
                    return { property: sort === Sort.Title ? "Title" : "Author" };
                case Sort.Rating:
                case Sort.MightRead:
                    return function (book1, book2) {
                        // Non-Flagged books are always sorted to the end. Rated books sort based on
                        // their rating. Flagged books are sorted to the top for 'MightRead', and immediately
                        // after already rated books for 'Rating'.
                        var flaggedBookWeight = sort === Sort.Rating ? 0 : 6,
                            weighting1 = getWeighting(book1, flaggedBookWeight),
                            weighting2 = getWeighting(book2, flaggedBookWeight),
                            sortAscending = false,
                            result = weighting1 === weighting2 ? 0 : (weighting1 > weighting2 ? 1 : -1);
                        return { property: result, descending: !sortAscending };
                    };
            }
        };

        function getWeighting(book, flaggedBookWeight) {
            var flaggedBook = getFlaggedBook(book);
            return !flaggedBook ? -1 : (flaggedBook.IsFlaggedToRead ? flaggedBookWeight : flaggedBook.Rating);
        };

        function getFlaggedBook(book) {
            return $.grep(profile.FlaggedBooks, function (myFlaggedBook) {
                return myFlaggedBook.Book === book;
                // We can use === here, since our profile data source and books data source both share the same
                // data context (grep for "dataContext:" in this file).
            })[0];
        };

        function enableFlaggingForBook(book, bookElement) {
            var flaggedBook = getFlaggedBook(book),  // Will be null if current profile hasn't yet saved/rated this book.
                $button = $("input.book-button", bookElement),
                ratingChanged;

            if (flaggedBook) {
                // Style the Save button based on initial flaggedBook.Rating value.
                styleSaveBookButton();

                // Clicks on the star rating control are translated onto "flaggedBook.Rating".
                ratingChanged = function (event, value) {
                    $.observable(flaggedBook).setProperty("Rating", value.rating);
                    styleSaveBookButton();
                };
            } else {
                // If this book has not yet been flagged by the user create a new flagged book 
                flaggedBook = { BookId: book.Id, Rating: 0 };

                // Clicking on the Save button will add the new flagged book entity to "profile.FlaggedBooks".
                $button.click(function () {
                    $.observable(profile.FlaggedBooks).insert(0, flaggedBook);
                    styleSaveBookButton();
                });

                // Clicks on the star rating control are translated onto "flaggedBook.Rating". Also, since the book
                // was not previously flagged, this will also add a new flagged book entity to "profile.FlaggedBooks".
                ratingChanged = function (event, value) {
                    $.observable(flaggedBook).setProperty("Rating", value.rating);
                    $.observable(profile.FlaggedBooks).insert(0, flaggedBook);
                    styleSaveBookButton();
                };
            }

            // Bind our ratingChanged method to the appropriate event from the starRating control
            $(".star-rating", bookElement)
                .starRating(flaggedBook.Rating)
                .bind("ratingChanged", ratingChanged);

            function styleSaveBookButton() {
                $button
                    .val(flaggedBook.Rating > 0 ? "Done reading" : "Might read it")
                    .removeClass("book-notadded book-saved book-read")
                    .addClass(flaggedBook.Rating > 0 ? "book-read" : "book-saved")
                    .disable();
            };
        };
    };
});
