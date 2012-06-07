using System;
using System.Web.Security;

namespace BigShelf.Account
{
    public partial class TestLogin : System.Web.UI.Page
    {
        protected void Page_Load(object sender, EventArgs e)
        {
            string userEmail = "demo@microsoft.com";
            string password = "abc123";
            if (Membership.ValidateUser(userEmail, password))
            {
                FormsAuthentication.SetAuthCookie(userEmail, true);
                FormsAuthentication.Authenticate(userEmail, password);
                Response.Redirect("../Default.aspx");
            }
        }
    }
}